"use client";
import { useMemo, useSyncExternalStore } from "react";
import { loadProfile, PROFILE_EVENT, PROFILE_KEY, type Profile } from "./profile";

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

export function useProfile(): Profile | null {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = raw !== SERVER;
  return useMemo(() => (hydrated ? loadProfile() : null), [raw, hydrated]);
}