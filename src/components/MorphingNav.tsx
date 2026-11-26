"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "@/lib/location-context";
import { useTTS } from "@/lib/use-tts";
import { useProfile } from "@/lib/useProfile";
interface Message {
  id: string;
  sender: "user" | "agent";
  text: string;
  time: string;
  // Distinguish model answers from data-only summaries for visual styling only
  source?: "model" | "data_only" | "error";
}

interface ChatAPIResponse {
  status: "ok" | "degraded" | "error";
  source?: "model" | "data_only" | "error";
  requestId: string;
  reply: string;
  reason?: string;
  location?: {
    latitude: number;
    longitude: number;
    name: string;
    isDefault: boolean;
  };
  dataSummary?: Record<string, unknown>;
  error?: string;
  code?: string;
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: "m-1",
    sender: "agent",
    text: "Hello! I'm your AI climate & lifestyle assistant. Ask me about weather, AQI trends, or planning your day for any location.",
    time: "Just now",
  },
];

const PROMPT_SUGGESTIONS = [
  "What day is it today?",
  "What is the AQI right now?",
  "Will it rain?",
];

export default function MorphingNav() {
  const { state: locationState } = useLocation();
  const { speak, stop, isSpeaking, isSupported } = useTTS();
  const profile = useProfile();
  const [isOpen, setIsOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputVal, setInputVal] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Stale response protection: track latest request ID
  const latestRequestIdRef = useRef<string | null>(null);
  // Pending flag to prevent duplicate submissions
  const isSubmittingRef = useRef(false);
  // Mirror of messages state for synchronous access in handleSend
  const messagesRef = useRef<Message[]>(INITIAL_MESSAGES);
  // Keep ref in sync with state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "instant",
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }, [messages, isTyping, isOpen, scrollToBottom]);

  // Global Escape key dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setIsLocked(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (isLocked) return;
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputVal).trim();
    if (!query || isTyping || isSubmittingRef.current) return;

    // Create user message
    const userMessage: Message = {
      id: `u-${crypto.randomUUID()}`,
      sender: "user",
      text: query,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    // Update state: add user message, clear input, lock, set typing
    const newMessages = [...messagesRef.current, userMessage];
    setMessages(newMessages);
    messagesRef.current = newMessages;
    setInputVal("");
    setIsLocked(true);
    setIsTyping(true);
    isSubmittingRef.current = true;

    // Generate request ID for stale response protection
    const requestId = crypto.randomUUID();
    latestRequestIdRef.current = requestId;

    // Build history for API (exclude current user message, bounded)
    // Only send complete user-assistant pairs; history should end with assistant
    const historyForAPI = (() => {
      const result: { role: "user" | "assistant"; content: string }[] = [];
      // Build from completed successful exchanges only
      // Exclude: welcome message, error/degraded notices, pending messages
      for (let i = 0; i < messagesRef.current.length; i++) {
        const m = messagesRef.current[i];
        if (m.sender === "user") {
          result.push({ role: "user", content: m.text });
        } else if (m.sender === "agent" && m.source === "model") {
          // Only include successful model responses in history
          result.push({ role: "assistant", content: m.text });
        }
      }
      // Remove the last user message (the one we just sent) from history
      // since it's sent separately as the current question
      const lastUserIndex = result.findLastIndex((m) => m.role === "user");
      if (lastUserIndex >= 0) {
        result.splice(lastUserIndex, 1);
      }
      // Bound to last 3 turns (6 messages) - but ensure we keep complete pairs
      // and start with user, end with assistant
      if (result.length > 6) {
        // Remove from the front until we have at most 6, but ensure we start with user
        const excess = result.length - 6;
        // Remove pairs (user+assistant) from the front to preserve structure
        const pairsToRemove = Math.ceil(excess / 2);
        const messagesToRemove = pairsToRemove * 2;
        result.splice(0, Math.min(messagesToRemove, result.length - 1));
      }
      // Ensure history starts with user and ends with assistant
      // If it starts with assistant, remove the first message
      if (result.length > 0 && result[0].role === "assistant") {
        result.shift();
      }
      // If it ends with user, remove the last message
      if (result.length > 0 && result[result.length - 1].role === "user") {
        result.pop();
      }
      return result;
    })();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          latitude: locationState.latitude,
          longitude: locationState.longitude,
          locationName: locationState.displayName,
          history: historyForAPI,
          profile: profile ? { name: profile.name, contexts: profile.contexts } : undefined,
        }),
      });

      // Stale response protection: ignore if newer request started
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      const data: ChatAPIResponse = await res.json();

      // Handle non-2xx responses with structured error details
      if (!res.ok) {
        const errorMsg = data.error || data.reply || "Request failed";
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${crypto.randomUUID()}`,
            sender: "agent",
            text: errorMsg,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            source: "error",
          },
        ]);
        return;
      }

      // Stale check again after await
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      // Add agent response with source for visual distinction
      const agentMessage: Message = {
        id: `a-${crypto.randomUUID()}`,
        sender: "agent",
        text: data.reply,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        source: data.source,
      };

      setMessages((prev) => [...prev, agentMessage]);
    } catch (err: unknown) {
      // Stale check
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      console.error("Chat communication failure:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${crypto.randomUUID()}`,
          sender: "agent",
          text: "I couldn't connect to the weather service. Please check your connection and try again.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          source: "error",
        },
      ]);
    } finally {
      // Always clear typing and submitting state
      setIsTyping(false);
      isSubmittingRef.current = false;
    }
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    handleSend(suggestion);
  };

  const locationLabel = locationState.displayName
    ? locationState.displayName.replace(/ \(default.*/, "")
    : "Unknown location";

  return (
    <>
      {/* Dimmed backdrop when card is locked open */}
      <AnimatePresence>
        {isOpen && isLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setIsOpen(false);
              setIsLocked(false);
            }}
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-end justify-center select-none font-sans pointer-events-none">
        <motion.div
          layout
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={() => setIsLocked(true)}
          transition={{
            type: "spring",
            stiffness: 380,
            damping: 30,
            mass: 0.7,
          }}
          className={`pointer-events-auto bg-[#101114]/92 border border-white/12 shadow-[0_25px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl flex flex-col justify-between overflow-hidden cursor-default ${
            isOpen
              ? "w-[360px] sm:w-[420px] h-[540px] rounded-[32px] p-5 sm:p-6"
              : "w-[150px] h-[48px] rounded-full px-4 py-2 hover:border-white/20 hover:shadow-[0_10px_25px_rgba(0,0,0,0.5)] cursor-pointer"
          }`}
        >
          {isOpen ? (
            <div className="flex-1 flex flex-col justify-between w-full h-full overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                    <span className="absolute w-4 h-4 rounded-full bg-emerald-400/20 animate-ping" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white tracking-tight">
                      AI Assistant{profile?.name ? `, ${profile.name}` : ""}
                    </h4>
                    <p className="text-[10px] text-emerald-400/90 font-medium tracking-wider uppercase">
                      Nemotron 3.5 Lightning
                    </p>
                    <p className="text-[9px] text-white/40 font-mono truncate max-w-[200px]">
                      Location: {locationLabel}
                      {locationState.source === "default" && <span className="text-amber-400"> (default)</span>}
                    </p>
                  </div>
                </div>

                {isLocked && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      stop();
                      setIsOpen(false);
                      setIsLocked(false);
                    }}
                    className="text-xs text-white/50 hover:text-white px-2 py-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                )}
              </div>

              {/* Message History Viewport */}
              <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                className="flex-1 overflow-y-auto space-y-3 py-3 pr-1 text-sm select-text scroll-smooth scrollbar-thin scrollbar-thumb-white/10"
              >
                {messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 26 }}
                    className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                        m.sender === "user"
                          ? "bg-white text-neutral-950 font-medium rounded-br-sm"
                          : m.source === "data_only"
                            ? "bg-amber-900/30 text-amber-100 border border-amber-400/30 rounded-bl-sm"
                            : m.source === "error"
                              ? "bg-red-900/30 text-red-100 border border-red-400/30 rounded-bl-sm"
                              : "bg-white/8 text-white/90 border border-white/10 rounded-bl-sm"
                      }`}
                    >
                      {m.text}
                    </div>
                    {m.sender === "agent" && isSupported && (
                      <button
                        type="button"
                        onClick={() => (isSpeaking ? stop() : speak(m.text))}
                        aria-label={isSpeaking ? "Stop speaking" : "Read aloud"}
                        className="mt-1 text-[11px] text-white/50 hover:text-white transition-colors cursor-pointer flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10"
                      >
                        <span>{isSpeaking ? "⏹ Stop" : "🔊 Listen"}</span>
                      </button>
                    )}
                    <span className="text-[10px] text-white/30 px-1 mt-1">{m.time}</span>
                  </motion.div>
                ))}

                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    aria-label="Agent is generating response"
                    className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white/8 border border-white/10 rounded-2xl w-fit"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
                  </motion.div>
                )}
              </div>

              {/* Prompt Suggestions */}
              {messages.length <= 2 && (
                <div className="flex gap-1.5 pb-2.5 overflow-x-auto no-scrollbar">
                  {PROMPT_SUGGESTIONS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSuggestionClick(prompt)}
                      className="text-[11px] whitespace-nowrap bg-white/6 hover:bg-white/12 text-white/70 hover:text-white border border-white/10 rounded-full px-3 py-1 transition-all cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2 pt-2 border-t border-white/10"
              >
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onFocus={() => setIsLocked(true)}
                  placeholder="Ask about weather, AQI, day..."
                  className="flex-1 bg-white/8 border border-white/10 focus:border-white/30 rounded-xl px-3.5 py-2 text-xs text-white placeholder-white/40 outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={!inputVal.trim() || isTyping}
                  className="bg-white disabled:opacity-30 text-neutral-950 rounded-xl px-3.5 py-2 text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer"
                >
                  Send
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              <span className="text-xs font-semibold tracking-wider uppercase text-white/85">
                AI Chat
              </span>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}