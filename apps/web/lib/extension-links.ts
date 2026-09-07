import type { Browser } from "@bookmark-ai/types";
import { detectSource } from "./detect";
import {
  downloadAnchor,
  getPlatform,
  storeUrlFor,
  type PlatformId,
  type PlatformStatus,
} from "./platforms";

/**
 * Where "Get the extension" sends people — DERIVED from lib/platforms.ts, the
 * single source of truth for every platform's status and URL.
 *
 * Rule: a store listing is linked only when that platform is `available`.
 * While a listing is under review (it 404s until approval) or not submitted
 * yet, the link goes to the platform's card on /download, which carries the
 * status, the sideload zip and the build-from-source path instead.
 */

type ExtensionPlatform = Extract<PlatformId, "chrome" | "firefox" | "safari">;

function linkFor(id: ExtensionPlatform): string {
  return storeUrlFor(id) ?? downloadAnchor(id);
}

export const EXTENSION_STORE_URLS = {
  /** Chrome Web Store listing — also serves Edge and Arc. */
  chrome: linkFor("chrome"),
  /** addons.mozilla.org (AMO) listing. */
  firefox: linkFor("firefox"),
  /** Mac App Store listing (Safari web extension). */
  safari: linkFor("safari"),
  /** The download page, for browsers we can't identify. */
  all: "/download",
} as const;

export type ExtensionStore = keyof typeof EXTENSION_STORE_URLS;

export interface ExtensionTarget {
  store: ExtensionStore;
  /** The platform entry behind this target, or null for the generic page. */
  platform: ExtensionPlatform | null;
  status: PlatformStatus;
  url: string;
  /** True for a store listing (new tab); false for our own /download page. */
  external: boolean;
  /**
   * Button label. Names the browser the user is actually in ("Add to Edge")
   * even when the listing behind it is the Chrome one — the store is our
   * plumbing, not their concern. While the listing isn't available the label
   * turns into an honest "Install options".
   */
  label: string;
  /** One line of status for the card, or null when the listing is live. */
  statusNote: string | null;
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

const STATUS_NOTES: Record<PlatformStatus, (storeName: string) => string | null> = {
  available: () => null,
  review: (store) => `${store} listing under review — available shortly. Sideload it meanwhile.`,
  soon: (store) => `${store} version coming soon — build from source, or use the web app.`,
};

const STORE_NAMES: Record<ExtensionPlatform, string> = {
  chrome: "Chrome Web Store",
  firefox: "Firefox Add-ons",
  safari: "Mac App Store",
};

/** The target for a known browser; pure, so it's unit-testable. */
export function extensionTargetForBrowser(browser: Browser): ExtensionTarget {
  const target = BROWSER_TARGETS[browser] ?? BROWSER_TARGETS.other;
  if (target.store === "all") return GENERIC_EXTENSION_TARGET;
  const platform = target.store;
  const { status } = getPlatform(platform);
  const url = EXTENSION_STORE_URLS[platform];
  return {
    store: platform,
    platform,
    status,
    url,
    external: url.startsWith("https://"),
    label: status === "available" ? target.label : "Install options",
    statusNote: STATUS_NOTES[status](STORE_NAMES[platform]),
  };
}

/** Rendered when there's no `navigator` (SSR) and for unrecognized browsers. */
export const GENERIC_EXTENSION_TARGET: ExtensionTarget = {
  store: "all",
  platform: null,
  status: "review",
  url: EXTENSION_STORE_URLS.all,
  external: false,
  label: BROWSER_TARGETS.other.label,
  statusNote: "Store listings under review — sideload or build from source meanwhile.",
};

/**
 * The target for the browser we're running in, reusing the app's one
 * user-agent parser (`detectSource`) rather than sniffing the UA a second way.
 *
 * SSR-safe: with no `navigator` it returns the generic target. Because the
 * server and the client would then disagree on the label, call it from an
 * effect — `useExtensionTarget` in components/library/extension-cta.tsx does.
 */
export function detectExtensionTarget(): ExtensionTarget {
  if (typeof navigator === "undefined") return GENERIC_EXTENSION_TARGET;
  return extensionTargetForBrowser(detectSource().browser);
}
