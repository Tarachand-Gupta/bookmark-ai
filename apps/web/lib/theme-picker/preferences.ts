import { PRESET_NAMES, type PresetName } from "./catalog";
export const THEME_PREFERENCE_KEY = "bookmark-ai:appearance:v2";
export const THEME_STYLE_ID = "bookmark-ai-theme-tokens";
export type ThemePreference = { version: 2; preset: PresetName };
export const DEFAULT_THEME_PREFERENCE: ThemePreference = { version: 2, preset: "default" };
export function parseThemePreference(raw: string | null): ThemePreference {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const data = value as Record<string, unknown>;
      if (data.version === 2 && PRESET_NAMES.includes(data.preset as PresetName))
        return { version: 2, preset: data.preset as PresetName };
    }
  } catch {
    /* Corrupt or unsupported settings restore Default. */
  }
  return { ...DEFAULT_THEME_PREFERENCE };
}
export function readThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    return parseThemePreference(storage.getItem(THEME_PREFERENCE_KEY));
  } catch {
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}
export function saveThemePreference(
  storage: Pick<Storage, "setItem" | "removeItem">,
  preference: ThemePreference,
): boolean {
  try {
    if (preference.preset === "default") storage.removeItem(THEME_PREFERENCE_KEY);
    else storage.setItem(THEME_PREFERENCE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}
