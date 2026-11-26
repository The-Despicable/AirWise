"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "@/lib/location-context";
import {
  PROFILE_EVENT,
  PROFILE_KEY,
  OPEN_SETUP_EVENT,
  loadProfile,
  saveProfile,
  type SavedPlace,
} from "@/lib/profile";
import { OnboardingOverlay, type OnboardingResult } from "./OnboardingOverlay";

const SERVER = "__server__";

function subscribe(cb: () => void) {
  window.addEventListener(PROFILE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PROFILE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function getSnapshot() {
  try {
    return window.localStorage.getItem(PROFILE_KEY) ?? "";
  } catch {
    return "";
  }
}
function getServerSnapshot() {
  return SERVER;
}

export function OnboardingGate() {
  const location = useLocation();
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = raw !== SERVER;
  const profile = useMemo(() => (hydrated ? loadProfile() : null), [raw, hydrated]);
  const [editing, setEditing] = useState(false);

  const applyRef = useRef<(p: SavedPlace) => void>(() => {});
  useEffect(() => {
    applyRef.current = (p) => location.setManualLocation(p.lat, p.lon, p.name, p.elevation);
  });

  const restored = useRef(false);
  useEffect(() => {
    if (hydrated && profile?.location && !restored.current) {
      restored.current = true;
      applyRef.current(profile.location);
    }
  }, [hydrated, profile]);

  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener(OPEN_SETUP_EVENT, open);
    return () => window.removeEventListener(OPEN_SETUP_EVENT, open);
  }, []);

  const show = hydrated && (!profile || editing);
  const initial: OnboardingResult | null = profile
    ? { name: profile.name, contexts: profile.contexts, location: profile.location }
    : null;

  const handleDone = (r: OnboardingResult) => {
    saveProfile(r);
    if (r.location) applyRef.current(r.location);
    setEditing(false);
  };
  const handleSkip = () => {
    if (!profile) saveProfile({ name: "", contexts: [], location: null });
    setEditing(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <OnboardingOverlay
          key="onboarding"
          mode={profile ? "edit" : "first"}
          initial={initial}
          onDone={handleDone}
          onSkip={handleSkip}
        />
      )}
    </AnimatePresence>
  );
}