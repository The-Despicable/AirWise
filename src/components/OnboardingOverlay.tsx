"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTEXT_KEYS, sanitizeName, type ContextKey, type SavedPlace } from "@/lib/profile";

const GREETING = "Hi, this is AirWise AI, and I'm Laura, your personal assistant.";
const INTRO_SRC = "/audio/intro.mp3";

const CONTEXT_LABELS: Record<ContextKey, string> = {
  parent: "Parent with children",
  commuter: "Daily commuter",
  student: "Student / outdoor sports",
  household: "Cooks at home / busy road nearby",
  sensitive: "Sensitive to air quality",
};

interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  admin1?: string;
}

export interface OnboardingResult {
  name: string;
  contexts: ContextKey[];
  location: SavedPlace | null;
}

interface Props {
  mode: "first" | "edit";
  initial?: OnboardingResult | null;
  onDone: (result: OnboardingResult) => void;
  onSkip: () => void;
}

export function OnboardingOverlay({ mode, initial, onDone, onSkip }: Props) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<"start" | "setup">(mode === "edit" ? "setup" : "start");
  const [name, setName] = useState(initial?.name ?? "");
  const [contexts, setContexts] = useState<ContextKey[]>(initial?.contexts ?? []);
  const [place, setPlace] = useState<SavedPlace | null>(initial?.location ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Preload the greeting silently; it only plays from the Start click.
  useEffect(() => {
    if (mode !== "first") return;
    const audio = new Audio(INTRO_SRC);
    audio.preload = "auto";
    const on = () => setSpeaking(true);
    const off = () => setSpeaking(false);
    audio.addEventListener("play", on);
    audio.addEventListener("pause", off);
    audio.addEventListener("ended", off);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("play", on);
      audio.removeEventListener("pause", off);
      audio.removeEventListener("ended", off);
      audioRef.current = null;
    };
  }, [mode]);

  const playGreeting = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    const p = audio.play();
    if (p) {
      p.then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    }
  }, []);

  const stopGreeting = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  // Start click is the user gesture: call play() directly, then move on.
  const handleStart = () => {
    playGreeting();
    setStep("setup");
  };

  const finish = () => {
    stopGreeting();
    onDone({ name: sanitizeName(name), contexts, location: place });
  };

  const skip = useCallback(() => {
    stopGreeting();
    onSkip();
  }, [onSkip, stopGreeting]);

  // City search (India), debounced.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // Defer state updates to next tick
      setTimeout(() => {
        setResults([]);
        setSearchError(false);
        setSearching(false);
      }, 0);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
        url.searchParams.set("name", q);
        url.searchParams.set("count", "5");
        url.searchParams.set("language", "en");
        url.searchParams.set("countryCode", "IN");
        url.searchParams.set("format", "json");
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results.slice(0, 5) : []);
        setSearchError(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setResults([]);
          setSearchError(true);
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const chooseResult = (r: GeoResult) => {
    setPlace({
      lat: r.latitude,
      lon: r.longitude,
      name: [r.name, r.admin1].filter(Boolean).join(", "),
      elevation: typeof r.elevation === "number" ? r.elevation : null,
      source: "manual",
    });
    setQuery("");
    setResults([]);
  };

  const useDeviceLocation = () => {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setPlace({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          name: "Your current location",
          elevation: null,
          source: "device",
        }),
      () => setGeoError("Couldn't get your location. You can search for a city instead."),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  const toggleContext = (key: ContextKey) =>
    setContexts((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  // Focus management + simple focus trap + Escape to skip.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      skip();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input");
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const dur = reduce ? 0.2 : 0.45;
  const lift = reduce ? 0 : 12;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to AirWise"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: dur }}
    >
      <motion.div
        ref={panelRef}
        className="w-full max-w-md rounded-3xl border border-white/15 bg-neutral-900/55 p-6 text-white shadow-2xl backdrop-blur-2xl"
        initial={{ opacity: 0, y: lift }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
        transition={{ duration: dur }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {step === "start" ? (
            <motion.div
              key="start"
              initial={{ opacity: 0, y: lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -lift }}
              transition={{ duration: dur }}
              className="text-center"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">Welcome to</p>
              <h1 className="mt-1 text-3xl font-semibold">AirWise</h1>
              <p className="mt-3 text-sm text-white/70">
                Weather and air-quality guidance for your location and your daily routine.
              </p>
              <button
                type="button"
                data-autofocus
                onClick={handleStart}
                className="mt-6 w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                Start
              </button>
              <button
                type="button"
                onClick={skip}
                className="mt-3 text-xs text-white/60 underline-offset-2 hover:underline"
              >
                Skip setup
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -lift }}
              transition={{ duration: dur }}
            >
              {mode === "first" && (
                <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full bg-emerald-400 ${speaking && !reduce ? "animate-pulse" : ""}`}
                      aria-hidden
                    />
                    <span className="text-sm font-medium">AirWise AI</span>
                    <span className="ml-auto text-xs text-white/50">{speaking ? "Speaking…" : "Assistant"}</span>
                  </div>
                  <p className="mt-2 text-sm text-white/80" aria-live="polite">
                    {GREETING}
                  </p>
                  <div className="mt-2 flex gap-3 text-xs text-white/60">
                    <button type="button" onClick={playGreeting} className="hover:text-white">
                      {audioBlocked ? "Tap to hear" : "Replay"}
                    </button>
                    <button type="button" onClick={stopGreeting} className="hover:text-white">
                      Mute
                    </button>
                  </div>
                </div>
              )}

              <h2 className="text-lg font-semibold">Set up your experience</h2>

              <label className="mt-4 block text-xs text-white/70" htmlFor="aw-name">
                Your name (optional)
              </label>
              <input
                id="aw-name"
                data-autofocus
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/40"
                placeholder="e.g. Asha"
                autoComplete="given-name"
              />

              <p className="mt-4 text-xs text-white/70">Your location</p>
              {place ? (
                <div className="mt-1 flex items-center justify-between rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm">
                  <span>
                    {place.name}
                    <span className="ml-2 text-xs text-white/50">
                      {place.source === "device" ? "device" : "selected"}
                    </span>
                  </span>
                  <button type="button" onClick={() => setPlace(null)} className="text-xs text-white/60 hover:text-white">
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search for an Indian city"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/40"
                    placeholder="Search a city in India"
                  />
                  {searching && <p className="mt-1 text-xs text-white/50">Searching…</p>}
                  {searchError && <p className="mt-1 text-xs text-amber-300">Search is unavailable right now.</p>}
                  {results.length > 0 && (
                    <ul className="mt-1 overflow-hidden rounded-xl border border-white/15 bg-neutral-900/80">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => chooseResult(r)}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
                          >
                            {r.name}
                            {r.admin1 ? `, ${r.admin1}` : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={useDeviceLocation}
                    className="mt-2 text-xs text-white/70 underline-offset-2 hover:underline"
                  >
                    Use my current location
                  </button>
                  {geoError && <p className="mt-1 text-xs text-amber-300">{geoError}</p>}
                  <p className="mt-1 text-xs text-white/40">If you skip this, AirWise uses a default location.</p>
                </>
              )}

              <p className="mt-4 text-xs text-white/70">About you (optional)</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {CONTEXT_KEYS.map((key) => {
                  const on = contexts.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleContext(key)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        on ? "border-white bg-white text-black" : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                      }`}
                    >
                      {CONTEXT_LABELS[key]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-white/40">Used only to tailor advice. Not medical advice. Stored on this device.</p>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={finish}
                  className="flex-1 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  Continue
                </button>
                <button type="button" onClick={skip} className="text-xs text-white/60 underline-offset-2 hover:underline">
                  Skip
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}