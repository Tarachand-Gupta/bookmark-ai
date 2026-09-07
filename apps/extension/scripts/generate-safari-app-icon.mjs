// Generates the macOS app icon set for the Safari container app
// (`safari-app/App/Assets.xcassets/AppIcon.appiconset/`) from the SAME
// bookmark mark as the toolbar icons, drawn on Apple's macOS app-icon grid:
// the artwork is 824/1024 of the canvas (100 px margin each side at 1024) with
// a corner radius of ~22.5 % of the artwork. No drop shadow — the flat plate is
// the pre-Tahoe fallback; on macOS 26 Xcode picks `App/AppIcon.icon` (the Icon
// Composer document shared with apps/macos) and renders the Liquid Glass look.
//
// Run: pnpm icons:safari-app   (dependency-free, deterministic — commit the output)
//
// The 1024×1024 entry (512pt @2x) is what App Store Connect uses as the App
// Store icon for a Mac app built with Xcode ≥ 10; nothing is uploaded by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, render, TARGETS } from "./generate-icons.mjs";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "safari-app",
  "App",
  "Assets.xcassets",
  "AppIcon.appiconset",
);

/** macOS app-icon grid: 824/1024 artwork, radius 185.4/824 (Apple's template). */
export const MACOS_GRID = { inset: 100 / 1024, radius: 185.4 / 824 };

/** Pixel sizes an appiconset with the `mac` idiom needs (1x/2x pairs share files). */
export const MAC_ICON_PIXEL_SIZES = [16, 32, 64, 128, 256, 512, 1024];

/** `Contents.json` entries — every macOS point size at 1x and 2x, file per pixel size. */
export const MAC_ICON_CONTENTS = {
  images: [16, 32, 128, 256, 512].flatMap((pt) =>
    [1, 2].map((scale) => ({
      filename: `icon_${pt * scale}.png`,
      idiom: "mac",
      scale: `${scale}x`,
      size: `${pt}x${pt}`,
    })),
  ),
  info: { author: "xcode", version: 1 },
};

const PROD_PLATE = TARGETS.find((t) => t.dir === "icon").bg;

mkdirSync(OUT_DIR, { recursive: true });
for (const px of MAC_ICON_PIXEL_SIZES) {
  const file = join(OUT_DIR, `icon_${px}.png`);
  writeFileSync(file, encodePng(px, render(px, PROD_PLATE, MACOS_GRID)));
  console.log(`wrote ${file}`);
}
writeFileSync(join(OUT_DIR, "Contents.json"), JSON.stringify(MAC_ICON_CONTENTS, null, 2) + "\n");
console.log(`wrote ${join(OUT_DIR, "Contents.json")}`);
