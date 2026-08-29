import type { LiveDevice, LiveTab, LiveWindow } from "@bookmark-ai/types";

/**
 * On-device filtering for the Sessions tab's Live segment.
 *
 * Purely client-side: `useLiveDevices` already holds the whole
 * `ListLiveResponse` snapshot in memory and re-pushes it over SSE on every
 * change, so filtering is a memo over the CURRENT snapshot — never a request,
 * never an index. The live schema bounds a device at 12 windows × 100 tabs, so
 * the plain scans below cost less than anything that would replace them.
 *
 * KEPT SEMANTICALLY IDENTICAL to `apps/web/lib/live-filter.ts`, which is where
 * the unit tests for these rules live (mobile has no test runner): terms are the
 * lowercased whitespace-split query, and a tab matches when EVERY term is a
 * substring of `title + " " + url`. Change one file, change the other.
 *
 * Distinct from `useLiveSearchMatches`, which powers the Search tab: that one
 * fetches its own device list, folds the window's NAME into the haystack, and
 * returns flattened match groups. This one filters a snapshot the Live segment
 * is already rendering, in place.
 */

/** Lowercase, split on whitespace, drop empties. No terms = nothing is filtered. */
export function liveFilterTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** AND over the terms against one tab's `title + " " + url`, lowercased. */
export function tabMatchesTerms(tab: Pick<LiveTab, "title" | "url">, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${tab.title} ${tab.url}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * The tabs of `win` to render under `terms` — the window's OWN array (same
 * reference) when nothing is being filtered.
 *
 * This narrows what's DISPLAYED only: callers keep the untouched `win` for
 * anything acting on the window as a whole (saving it as a session), so a
 * filtered card can never silently save a subset of its tabs.
 */
export function matchingTabs(win: Pick<LiveWindow, "tabs">, terms: string[]): LiveTab[] {
  if (terms.length === 0) return win.tabs;
  return win.tabs.filter((tab) => tabMatchesTerms(tab, terms));
}

/** How many of a device's tabs match — both the "does this device survive the
 * filter" test and the count the UI reports. */
export function deviceMatchCount(device: Pick<LiveDevice, "windows">, terms: string[]): number {
  let count = 0;
  for (const win of device.windows) {
    for (const tab of win.tabs) if (tabMatchesTerms(tab, terms)) count++;
  }
  return count;
}

/**
 * Devices with at least one matching tab, in their original order. Returns the
 * SAME array when there are no terms. The inactive-device fold is the caller's
 * business — a matching tab on a quiet device still has to be reachable, so the
 * screen unfolds that group while a query is on.
 */
export function filterLiveDevices(devices: LiveDevice[], terms: string[]): LiveDevice[] {
  if (terms.length === 0) return devices;
  return devices.filter((device) => deviceMatchCount(device, terms) > 0);
}

/** Total matching tabs across a device list — the "N matching tabs" hint. */
export function totalMatchCount(devices: LiveDevice[], terms: string[]): number {
  return devices.reduce((sum, device) => sum + deviceMatchCount(device, terms), 0);
}
