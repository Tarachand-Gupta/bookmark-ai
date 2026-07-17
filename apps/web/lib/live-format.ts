import type { LiveTab } from "@bookmark-ai/types";

// Freshness is the server's integer `lastSeenAgeSeconds` (§4.4). Never subtract
// a client clock; these helpers only turn that one number into a label + dot.

/** Below this (10 min), the presence dot is filled; at or above it, hollow + dim. */
export const FRESH_MAX_SECONDS = 600;
/** At or above this (6 h), a device folds under "Show older". */
export const OLDER_MIN_SECONDS = 21600;

export interface DeviceFreshness {
  /** Filled presence dot (recently seen) vs. a hollow ring (gone quiet). */
  filled: boolean;
  /** Dim the card — the tabs are still useful, just older. */
  dim: boolean;
  /** Old enough to collapse under a "Show older" toggle. */
  older: boolean;
}

export function deviceFreshness(seconds: number): DeviceFreshness {
  return {
    filled: seconds < FRESH_MAX_SECONDS,
    dim: seconds >= FRESH_MAX_SECONDS,
    older: seconds >= OLDER_MIN_SECONDS,
  };
}

/** "as of just now" / "as of 6 min ago" / "as of 3 hours ago". Softened toward
 * live-ish for the common event-driven case, per the §4.4 rework note. */
export function formatDeviceAge(seconds: number): string {
  if (seconds < 15) return "as of just now";
  if (seconds < 60) return "as of a few seconds ago";
  if (seconds < 3600) {
    const m = Math.max(1, Math.round(seconds / 60));
    return `as of ${m} min ago`;
  }
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return `as of ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(seconds / 86400);
  return `as of ${d} day${d === 1 ? "" : "s"} ago`;
}

/** A tab is openable only when it's a real http(s) link and wasn't redacted to
 * its origin at capture time — everything else renders as muted text (§4.7). */
export function isOpenableTab(tab: LiveTab): boolean {
  return !tab.redacted && /^https?:/i.test(tab.url);
}

/** The active tab's title is what lets you recognize a window (§4.5). */
export function windowSubtitle(tabs: LiveTab[]): string {
  const active = tabs.find((t) => t.active) ?? tabs[0];
  return active?.title?.trim() || active?.url || "";
}
