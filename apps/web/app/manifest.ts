import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/lib/theme-colors";

/**
 * Web app manifest, served at /manifest.webmanifest (Next 15 metadata route).
 * This is what turns "Add to Home Screen" into a real standalone install rather
 * than a Safari shortcut, and what Android reads for the launcher icon + splash.
 *
 * Choices worth knowing:
 * - `start_url: "/app"` — an installed app should open the library, not the
 *   marketing landing page.
 * - `scope: "/"`, NOT "/app" — sign-in, sign-up, privacy and terms all live
 *   outside /app, and anything outside scope opens in the browser instead of the
 *   installed shell. Scoping to /app would eject the user to Safari the moment
 *   Clerk redirected them to /sign-in.
 * - `background_color: #0a0a0a` (dark) even though the app follows the system
 *   theme. The manifest allows exactly one value and it is used for the launch
 *   splash, behind the icon — and the icon is a near-black field, so dark keeps
 *   the splash continuous with the mark. The alternative flashes a full white
 *   screen before a (commonly dark) app paints, which is the same complaint that
 *   produced this file. `theme_color` matches it for the same reason; it is only
 *   a starting value — on Android the live `<meta name="theme-color">` (see
 *   components/theme-color-meta.tsx) takes over once the page renders, and on iOS
 *   the page paints the status-bar strip itself (see the standalone block in
 *   globals.css), so neither surface stays stuck on this colour.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Bookmark AI",
    short_name: "Bookmark AI",
    description: "Save bookmarks from any browser — organized automatically by AI.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLOR.dark,
    theme_color: THEME_COLOR.dark,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
