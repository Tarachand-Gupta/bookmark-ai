import { PRESET_NAMES } from "./catalog";
import { themeCss } from "./css";
import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCE_KEY, THEME_STYLE_ID } from "./preferences";
/** Stored values can select only fixed, vendored CSS; arbitrary stored CSS never enters the document. */
export function themeBootstrapScript(): string {
  const data = JSON.stringify({
    css: Object.fromEntries(
      PRESET_NAMES.map((preset) => [preset, themeCss({ version: 2, preset })]),
    ),
    fallback: DEFAULT_THEME_PREFERENCE,
    key: THEME_PREFERENCE_KEY,
    styleId: THEME_STYLE_ID,
  }).replace(/</g, "\\u003c");
  return `(function(c){var p=c.fallback;try{var v=JSON.parse(localStorage.getItem(c.key));if(v&&v.version===2&&Object.prototype.hasOwnProperty.call(c.css,v.preset))p={version:2,preset:v.preset};}catch(e){}var s=document.createElement("style");s.id=c.styleId;s.textContent=c.css[p.preset];document.head.appendChild(s);document.documentElement.dataset.themePreset=p.preset;})(${data});`;
}
