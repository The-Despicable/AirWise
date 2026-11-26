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

interface Message {
  id: string;
  sender: "user" | "agent";
  text: string;
  time: string;
  // Distinguish model answers from data-only summaries
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
    id: "init-1",
    sender: "agent",
    text: "Hello! I'm Aria, your AirWise weather presenter. Ask me about the weather or air quality for the selected location.",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    source: "model",
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
  const [isOpen, setIsOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputVal, setInputVal] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Stale response protection: track latest request ID
  const latestRequestIdRef = useRef<string | null>(null);
  // Pending flag to prevent duplicate submissions
  const isSubmittingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen && (messages.length > 0 || isTyping)) {
      scrollToBottom();
    }
  }, [messages, isTyping, isOpen, scrollToBottom]);

  // Global Escape key dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        setIsLocked(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleMouseEnter = () => {
    if (!isLocked) setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (!isLocked) setIsOpen(false);
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
    setMessages((prev) => [...prev, userMessage]);
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
      // messages state already has the new user message appended
      // We need to send previous messages only (excluding the one just added)
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.sender === "user") {
          result.push({ role: "user", content: m.text });
        } else if (m.sender === "agent" && m.source !== "data_only" && m.source !== "error") {
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

  // TTS handler for agent messages
  const handleSpeak = (text: string) => {
    if (isSpeaking) {
      stop();
    } else {
      speak(text);
    }
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
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="pointer-events-auto"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Chat Card */}
          <AnimatePresence mode="wait">
            {isOpen && (
              <motion.div
                key="chat-open"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="w-[360px] sm:w-[420px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden flex flex-col"
                style={{ maxHeight: "60vh" }}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Aria</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{locationLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Lock toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsLocked(!isLocked);
                      }}
                      className={`p-2 rounded-lg transition-colors ${
                        isLocked
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                      aria-label={isLocked ? "Unlock position" : "Lock open"}
                      title={isLocked ? "Unlock position" : "Lock open"}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isLocked ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        )}
                      </svg>
                    </button>
                    {/* Close */}
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        setIsLocked(false);
                      }}
                      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      aria-label="Close chat"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Messages */}
                <div
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[400px]"
                >
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                          msg.sender === "user"
                            ? "bg-blue-600 text-white rounded-br-md"
                            : msg.source === "data_only"
                              ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 rounded-bl-md border border-amber-200 dark:border-amber-800"
                              : msg.source === "error"
                                ? "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200 rounded-bl-md border border-red-200 dark:border-red-800"
                                : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 rounded-bl-md"
                        }`}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        {/* Source indicator for agent messages */}
                        {msg.sender === "agent" && msg.source !== "model" && (
                          <p className="text-xs mt-1 opacity-70">
                            {msg.source === "data_only"
                              ? "⚠ Weather data only — AI advice unavailable"
                              : msg.source === "error"
                                ? "✕ Connection error"
                                : ""}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  {isTyping && (
                    <motion.div
                      key="typing"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-start"
                    >
                      <div className="bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 rounded-2xl rounded-bl-md px-4 py-2.5">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Input Area */}
                <div className="border-t border-gray-200/50 dark:border-gray-700/50 p-3 bg-gray-50/50 dark:bg-gray-800/50">
                  {messages.length <= 1 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {PROMPT_SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSuggestionClick(s)}
                          disabled={isTyping}
                          className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={inputVal}
                      onChange={(e) => setInputVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder="Ask about weather or air quality…"
                      disabled={isTyping}
                      className="flex-1 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
                      aria-label="Chat input"
                    />
                    <button
                      onClick={() => {
                        const lastAgentMsg = [...messages].reverse().find((m) => m.sender === "agent");
                        if (lastAgentMsg) handleSpeak(lastAgentMsg.text);
                      }}
                      disabled={!isSupported || messages.length <= 1 || isSpeaking}
                      className={`p-2 rounded-full transition-colors ${
                        isSpeaking
                          ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800"
                      }`}
                      aria-label={isSpeaking ? "Stop speaking" : "Read aloud"}
                      title={isSpeaking ? "Stop speaking" : "Read aloud"}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isSpeaking ? (
                          <>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </>
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        )}
                      </svg>
                    </button>
                    <button
                      onClick={() => handleSend()}
                      disabled={isTyping || inputVal.trim().length === 0}
                      className={`p-2.5 rounded-full transition-colors ${
                        isTyping || inputVal.trim().length === 0
                          ? "bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                      aria-label="Send message"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Button (when closed) */}
          <AnimatePresence>
            {!isOpen && (
              <motion.button
                key="chat-closed"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setIsOpen(true)}
                className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-xl flex items-center justify-center hover:from-blue-600 hover:to-cyan-600 transition-all duration-200"
                aria-label="Open chat with Aria"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
}