/**
 * The two page-background colors, as hex, for the places that CANNOT read CSS
 * variables: `<meta name="theme-color">` (which paints the iOS home-screen
 * status-bar band and the Android browser chrome) and the web app manifest.
 *
 * These MUST stay equal to `--background` in packages/ui/src/theme.css, where
 * they are authored in oklch:
 *   light  oklch(1 0 0)      = #ffffff
 *   dark   oklch(0.145 0 0)  = #0a0a0a
 * If a brand token changes there, change it here too — a mismatch shows up as a
 * visible seam between the status bar and the top of the page.
 */
export const THEME_COLOR = {
  light: "#ffffff",
  dark: "#0a0a0a",
} as const;

export type ThemeColorMode = keyof typeof THEME_COLOR;
