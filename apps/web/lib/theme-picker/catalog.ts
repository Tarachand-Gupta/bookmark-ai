import presets from "./presets.json";
import shadows from "./shadows.json";
import baseline from "./bookmark-ai-baseline.json";

export type ThemeTokens = Record<string, string>;
export type PresetName = keyof typeof presets;
export const PRESET_NAMES = Object.keys(presets) as PresetName[];
export const THEME_PRESETS = PRESET_NAMES.map((name) => ({ name, label: presets[name].label }));
const defaultShadows: ThemeTokens = {
  "picker-shadow-2xs": "0 1px rgb(0 0 0 / 0.05)",
  "picker-shadow-xs": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  "picker-shadow-sm": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  "picker-shadow-md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  "picker-shadow-lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  "picker-shadow-xl": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "picker-shadow-2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
};
export function themeTokens(name: PresetName, mode: "light" | "dark"): ThemeTokens {
  const styles = presets[name].styles[mode];
  const tokens = Object.fromEntries(
    Object.entries(styles).filter(
      ([key]) =>
        !key.startsWith("font-") &&
        !key.startsWith("shadow-") &&
        key !== "spacing" &&
        key !== "letter-spacing",
    ),
  );
  // Missing destructive foreground is resolved consistently for all presets.
  return {
    "destructive-foreground": styles["primary-foreground"],
    ...tokens,
    ...(name === "default" ? { ...baseline.light, ...baseline[mode] } : {}),
    ...(name === "default" ? defaultShadows : shadows[name][mode]),
    "picker-radius-xl":
      parseFloat(name === "default" ? baseline.light.radius : styles.radius) === 0
        ? "0px"
        : "calc(var(--radius) + 4px)",
  };
}
