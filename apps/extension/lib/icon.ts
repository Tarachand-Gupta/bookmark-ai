/**
 * Runtime URL of the extension's own icon, chosen per build target so the popup
 * shows the same color-coded plate the toolbar does (prod ⬛ / dev 🟩 / local 🟥).
 * WXT copies `public/*` to the output root, so `public/icon/48.png` is served at
 * `/icon/48.png`. The per-mode dir mapping MIRRORS `wxt.config.ts`'s `iconsFor`
 * (production → icon, dev-remote → icon-dev, development → icon-local); keep the
 * two in sync if a target's dir ever changes.
 */
const ICON_DIRS: Record<string, string> = {
  production: "icon",
  "dev-remote": "icon-dev",
  development: "icon-local",
};

export function iconUrl(size: 16 | 32 | 48 | 96 | 128 = 48): string {
  const dir = ICON_DIRS[import.meta.env.MODE] ?? "icon";
  return `/${dir}/${size}.png`;
}
