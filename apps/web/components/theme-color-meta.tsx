"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { THEME_COLOR } from "@/lib/theme-colors";
import { useThemePreferences } from "./theme-preferences-provider";

/**
 * Keeps `<meta name="theme-color">` in sync with the theme the app is ACTUALLY
 * showing. That meta tints browser chrome — Android Chrome's toolbar and task
 * switcher, an installed Android PWA's chrome, iOS Safari's toolbars — so when it
 * disagrees with the page you get a white strip above a dark app. (The iOS
 * home-screen status bar is handled separately and more reliably by
 * `appleWebApp.statusBarStyle: "black-translucent"`; see app/layout.tsx.)
 *
 * The static `viewport.themeColor` in app/layout.tsx ships two media-scoped
 * tags, light and dark, which is all that is needed for first paint and for the
 * "system" theme. But a MANUAL override (next-themes `theme: "light" | "dark"`)
 * is invisible to `prefers-color-scheme`: system-dark + app-set-to-light still
 * matches the dark tag and paints a black band over a white page.
 *
 * Fix: once the resolved theme is known, write the SAME color into both static
 * tags — whichever one the OS decides matches now carries the right color, so the
 * media queries stop mattering — and additionally (re)insert one unscoped tag of
 * our own. React's metadata tags are never removed or reordered here, only their
 * `content` is touched, so this cannot fight React's reconciliation of <head>.
 *
 * Renders nothing, so there is no server/client markup to mismatch: the theme is
 * only knowable in the browser, and reading it during render (or in a useState
 * initializer) is exactly how hydration errors get made.
 */

/** id of the one tag this component owns (and may freely delete). */
const OWNED_ID = "theme-color-resolved";

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();
  const { preference } = useThemePreferences();

  useEffect(() => {
    // Undefined until next-themes has resolved "system" against the OS.
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    // next-themes applies its root class in an effect; read after that write.
    const frame = requestAnimationFrame(() => {
      let color: string = THEME_COLOR[resolvedTheme];
      // Canvas resolves modern CSS colors to an opaque sRGB color accepted by browser chrome.
      try {
        const background = getComputedStyle(document.body).backgroundColor;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (context) {
          context.fillStyle = background;
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
          color = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
        } else color = background;
      } catch {
        /* Keep the existing neutral fallback on unsupported renderers. */
      }

      for (const tag of document.head.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"][media]',
      )) {
        tag.setAttribute("content", color);
      }

      // ...and re-insert an unscoped tag of our own. Some WebKit builds only
      // re-read theme-color when a tag is added or removed, not when an existing
      // tag's `content` changes, so replacing the node (rather than editing it) is
      // what actually makes the chrome repaint. Ours is the tag we own, so
      // removing it can never fight React's reconciliation of the static ones.
      document.getElementById(OWNED_ID)?.remove();
      const meta = document.createElement("meta");
      meta.id = OWNED_ID;
      meta.name = "theme-color";
      meta.content = color;
      document.head.appendChild(meta);
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme, preference]);

  return null;
}
