import { useColorScheme } from "react-native";

/**
 * Design tokens ported from packages/ui/src/theme.css (the single branding
 * source — shadcn neutral). oklch values converted to their Tailwind-neutral
 * hex equivalents; keep both files in sync on retheme.
 */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
}

export const lightColors: ThemeColors = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  cardForeground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#f5f5f5",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  border: "#e5e5e5",
  destructive: "#e7000b",
};

export const darkColors: ThemeColors = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  cardForeground: "#fafafa",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  secondary: "#262626",
  muted: "#262626",
  mutedForeground: "#a3a3a3",
  border: "rgba(255,255,255,0.10)",
  destructive: "#ff6467",
};

/** --radius: 0.625rem → 10, with the same sm/md/lg/xl derivations. */
export const radius = { sm: 6, md: 8, lg: 10, xl: 14 } as const;

export interface Theme {
  colors: ThemeColors;
  radius: typeof radius;
  dark: boolean;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  return { colors: dark ? darkColors : lightColors, radius, dark };
}
