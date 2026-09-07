import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SERVER_TARGET, type ServerTarget } from "../api";
import { resolveDark, type ThemePreference } from "../lib/appearance";
import { darkColors, lightColors, radius, type Theme } from "../theme";
import type { ViewMode } from "../components/SegmentedControl";

export type { ThemePreference } from "../lib/appearance";

interface Preferences {
  themePreference: ThemePreference;
  setThemePreference: (p: ThemePreference) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  /** Which backend this build targets — a BUILD-TIME constant (see SERVER_TARGET
   * in ../api), NOT user-settable. Exposed read-only so data hooks can still key
   * their refetch effects on it; it simply never changes at runtime now. */
  serverTarget: ServerTarget;
  /** True once persisted preferences (theme/view) have been read from storage.
   * Gates the first paint to avoid a theme flash. */
  hydrated: boolean;
  theme: Theme;
}

const PreferencesContext = createContext<Preferences | null>(null);

const THEME_KEY = "bookmark-ai:theme";
const VIEW_KEY = "bookmark-ai:view";

export function PreferencesProvider({ children }: { children: ReactNode }) {
  // The live OS scheme. Every themed surface — the presented Settings and chat
  // modals included — is a React descendant of this provider, so a change here
  // repaints them all in place. What can STOP this updating is native: see the
  // note on `resolveDark` about full-screen modals and `traitCollectionDidChange`.
  const system = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const [viewMode, setViewModeState] = useState<ViewMode>("list");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void AsyncStorage.multiGet([THEME_KEY, VIEW_KEY]).then(([[, theme], [, view]]) => {
      if (theme === "light" || theme === "dark" || theme === "system") {
        setThemePreferenceState(theme);
      }
      if (view === "list" || view === "cards") setViewModeState(view);
      setHydrated(true);
    });
  }, []);

  const setThemePreference = (p: ThemePreference) => {
    setThemePreferenceState(p);
    void AsyncStorage.setItem(THEME_KEY, p);
  };
  const setViewMode = (m: ViewMode) => {
    setViewModeState(m);
    void AsyncStorage.setItem(VIEW_KEY, m);
  };

  const value = useMemo<Preferences>(() => {
    const dark = resolveDark(themePreference, system);
    return {
      themePreference,
      setThemePreference,
      viewMode,
      setViewMode,
      serverTarget: SERVER_TARGET,
      hydrated,
      theme: { colors: dark ? darkColors : lightColors, radius, dark },
    };
  }, [themePreference, viewMode, hydrated, system]);

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
