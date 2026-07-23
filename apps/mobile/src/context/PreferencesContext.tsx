import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setServerTarget as syncServerTarget, type ServerTarget } from "../api";
import { darkColors, lightColors, radius, type Theme } from "../theme";
import type { ViewMode } from "../components/SegmentedControl";

export type ThemePreference = "system" | "light" | "dark";

interface Preferences {
  themePreference: ThemePreference;
  setThemePreference: (p: ThemePreference) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  serverTarget: ServerTarget;
  setServerTarget: (t: ServerTarget) => void;
  /** True once the persisted preferences have been read from storage. Gates
   * ClerkProvider so it mounts exactly once with the correct (target-derived)
   * publishable key instead of flashing the default first. */
  hydrated: boolean;
  theme: Theme;
}

const PreferencesContext = createContext<Preferences | null>(null);

const THEME_KEY = "bookmark-ai:theme";
const VIEW_KEY = "bookmark-ai:view";
const SERVER_KEY = "bookmark-ai:server";

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const [viewMode, setViewModeState] = useState<ViewMode>("list");
  // Shipping default is production — a fresh install talks to the deployed API
  // (and, via the target-derived key, the prod Clerk instance). Overridden by a
  // persisted choice below.
  const [serverTarget, setServerTargetState] = useState<ServerTarget>("production");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    syncServerTarget(serverTarget); // keep the hook-free data layer on the same default
    void AsyncStorage.multiGet([THEME_KEY, VIEW_KEY, SERVER_KEY]).then(
      ([[, theme], [, view], [, server]]) => {
        if (theme === "light" || theme === "dark" || theme === "system") {
          setThemePreferenceState(theme);
        }
        if (view === "list" || view === "cards") setViewModeState(view);
        if (server === "local" || server === "production") {
          setServerTargetState(server);
          syncServerTarget(server);
        }
        setHydrated(true);
      },
    );
  }, []);

  const setThemePreference = (p: ThemePreference) => {
    setThemePreferenceState(p);
    void AsyncStorage.setItem(THEME_KEY, p);
  };
  const setViewMode = (m: ViewMode) => {
    setViewModeState(m);
    void AsyncStorage.setItem(VIEW_KEY, m);
  };
  const setServerTarget = (t: ServerTarget) => {
    setServerTargetState(t);
    syncServerTarget(t); // keep the hook-free data layer in step
    void AsyncStorage.setItem(SERVER_KEY, t);
  };

  const value = useMemo<Preferences>(() => {
    const dark = themePreference === "system" ? system === "dark" : themePreference === "dark";
    return {
      themePreference,
      setThemePreference,
      viewMode,
      setViewMode,
      serverTarget,
      setServerTarget,
      hydrated,
      theme: { colors: dark ? darkColors : lightColors, radius, dark },
    };
  }, [themePreference, viewMode, serverTarget, hydrated, system]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}

/** Theme accessor for components — respects the Settings override. */
export function useAppTheme(): Theme {
  return usePreferences().theme;
}
