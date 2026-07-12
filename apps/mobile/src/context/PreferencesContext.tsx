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
  const [serverTarget, setServerTargetState] = useState<ServerTarget>("local");

  useEffect(() => {
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
      theme: { colors: dark ? darkColors : lightColors, radius, dark },
    };
  }, [themePreference, viewMode, serverTarget, system]);

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
