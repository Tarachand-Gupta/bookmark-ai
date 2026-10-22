"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_FLOATING_AI, FLOATING_AI_KEY, parseFloatingAiPreferences, type FloatingAiPreferences } from "@/lib/floating-ai-preferences";

let preferences = DEFAULT_FLOATING_AI;
const listeners = new Set<() => void>();

function update(next: FloatingAiPreferences) {
  if (next.desktop === preferences.desktop && next.mobile === preferences.mobile) return;
  preferences = next;
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === FLOATING_AI_KEY || event.key === null) {
    update(parseFloatingAiPreferences(event.newValue));
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    try { update(parseFloatingAiPreferences(localStorage.getItem(FLOATING_AI_KEY))); } catch { /* Use defaults when storage is blocked. */ }
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

function setPreference(platform: keyof FloatingAiPreferences, visible: boolean) {
  const next = { ...preferences, [platform]: visible };
  update(next);
  try { localStorage.setItem(FLOATING_AI_KEY, JSON.stringify(next)); } catch { /* Still apply for this session. */ }
}

export function useFloatingAi() {
  const value = useSyncExternalStore(subscribe, () => preferences, () => DEFAULT_FLOATING_AI);
  return { preferences: value, setPreference };
}
