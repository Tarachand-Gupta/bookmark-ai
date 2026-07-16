import type { Browser } from "@bookmark-ai/types";
import { detectSource } from "./detect";

/**
 * Where the extension is downloaded from — the ONE place these URLs live.
 *
 * ⚠️ THESE ARE PLACEHOLDERS. The extension is not published to any store yet.
 * TODO(tara): replace with the real Chrome Web Store / AMO / App Store listing
 * URLs once published. Every entry points at an obviously fake example.com URL
 * so an unreplaced link is impossible to mistake for a working one.
 */
export const EXTENSION_STORE_URLS = {
  /** TODO(tara): Chrome Web Store listing — also serves Edge and Arc. */
  chrome: "https://example.com/REPLACE-ME/bookmark-ai-chrome-web-store",
  /** TODO(tara): addons.mozilla.org (AMO) listing. */
  firefox: "https://example.com/REPLACE-ME/bookmark-ai-firefox-amo",
  /** TODO(tara): Mac App Store listing (Safari web extension). */
  safari: "https://example.com/REPLACE-ME/bookmark-ai-safari-app-store",
  /** TODO(tara): generic download page, for browsers we can't identify. */
  all: "https://example.com/REPLACE-ME/bookmark-ai-extension",
} as const;

export type ExtensionStore = keyof typeof EXTENSION_STORE_URLS;

export interface ExtensionTarget {
  store: ExtensionStore;
  url: string;
  /**
   * Button label. Names the browser the user is actually in ("Add to Edge")
   * even when the listing behind it is the Chrome one — the store is our
   * plumbing, not their concern.
   */
  label: string;
}

/** Chromium browsers all install from the Chrome Web Store. */
const BROWSER_TARGETS: Record<Browser, { store: ExtensionStore; label: string }> = {
  chrome: { store: "chrome", label: "Add to Chrome" },
  edge: { store: "chrome", label: "Add to Edge" },
  arc: { store: "chrome", label: "Add to Arc" },
  firefox: { store: "firefox", label: "Add to Firefox" },
  safari: { store: "safari", label: "Add to Safari" },
  other: { store: "all", label: "Get the extension" },
};

/** Rendered when there's no `navigator` (SSR) and for unrecognized browsers. */
export const GENERIC_EXTENSION_TARGET: ExtensionTarget = {
  store: "all",
  url: EXTENSION_STORE_URLS.all,
  label: BROWSER_TARGETS.other.label,
};

/**
 * The store listing for the browser we're running in, reusing the app's one
 * user-agent parser (`detectSource`) rather than sniffing the UA a second way.
 *
 * SSR-safe: with no `navigator` it returns the generic target. Because the
 * server and the client would then disagree on the label, call it from an
 * effect — `useExtensionTarget` in components/library/extension-cta.tsx does.
 */
export function detectExtensionTarget(): ExtensionTarget {
  if (typeof navigator === "undefined") return GENERIC_EXTENSION_TARGET;
  const { browser } = detectSource();
  const target = BROWSER_TARGETS[browser] ?? BROWSER_TARGETS.other;
  return { store: target.store, url: EXTENSION_STORE_URLS[target.store], label: target.label };
}
