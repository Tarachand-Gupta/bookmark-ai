import { themeTokens, type ThemeTokens } from "./catalog";
import { parseThemePreference, THEME_STYLE_ID, type ThemePreference } from "./preferences";
function block(selector: string, tokens: ThemeTokens) {
  return `${selector} {\n${Object.entries(tokens)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n")}\n}`;
}
export function themeCss(preference: ThemePreference): string {
  const safe = parseThemePreference(JSON.stringify(preference));
  return [
    block(":root", themeTokens(safe.preset, "light")),
    block(".dark", themeTokens(safe.preset, "dark")),
  ].join("\n\n");
}
export function applyThemePreference(doc: Document, preference: ThemePreference) {
  let style = doc.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = THEME_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = themeCss(preference);
  doc.documentElement.dataset.themePreset = preference.preset;
}
