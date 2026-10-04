"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { applyThemePreference } from "@/lib/theme-picker/css";
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_PREFERENCE_KEY,
  type ThemePreference,
} from "@/lib/theme-picker/preferences";

type ThemePreferenceState = {
  preference: ThemePreference;
  ready: boolean;
  update: (patch: Partial<Omit<ThemePreference, "version">>) => void;
  reset: () => void;
};
const Context = createContext<ThemePreferenceState | null>(null);

export function ThemePreferencesProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [ready, setReady] = useState(false);
  const { setTheme } = useTheme();
  useEffect(() => {
    let restored = DEFAULT_THEME_PREFERENCE;
    try {
      restored = readThemePreference(window.localStorage);
    } catch {
      /* Storage may be disabled. */
    }
    applyThemePreference(document, restored);
    setPreference(restored);
    setReady(true);
    function synchronize(event: StorageEvent) {
      if (event.key !== THEME_PREFERENCE_KEY && event.key !== null) return;
      const next = parseThemePreference(event.newValue);
      applyThemePreference(document, next);
      setPreference(next);
    }
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);

  const replace = useCallback((next: ThemePreference) => {
    applyThemePreference(document, next);
    setPreference(next);
    try {
      saveThemePreference(window.localStorage, next);
    } catch {
      /* Appearance still works in this tab. */
    }
  }, []);
  const update = useCallback(
    (patch: Partial<Omit<ThemePreference, "version">>) => {
      replace(parseThemePreference(JSON.stringify({ ...preference, ...patch })));
    },
    [preference, replace],
  );
  const reset = useCallback(() => {
    replace({ ...DEFAULT_THEME_PREFERENCE });
    setTheme("system");
  }, [replace, setTheme]);
  return (
    <Context.Provider value={{ preference, ready, update, reset }}>{children}</Context.Provider>
  );
}

export function useThemePreferences() {
  const state = useContext(Context);
  if (!state) throw new Error("Theme preferences require their root provider.");
  return state;
}
