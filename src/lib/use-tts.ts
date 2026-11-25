"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      setIsSupported(true);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      stop();
      if (!text) return;

      setIsSpeaking(true);

      try {
        // 1. Attempt ElevenLabs endpoint
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;

          audio.onended = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(url);
          };
          audio.onerror = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(url);
          };

          await audio.play();
          return;
        }
      } catch (err) {
        console.warn("ElevenLabs TTS unavailable, falling back to Web Speech:", err);
      }

      // 2. Fallback to native Web Speech API
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const clean = text.replace(/[*#_`]/g, "").trim();
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } else {
        setIsSpeaking(false);
      }
    },
    [stop]
  );

  return { speak, stop, isSpeaking, isSupported };
}
