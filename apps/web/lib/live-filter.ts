import type { LiveDevice, LiveTab, LiveWindow } from "@bookmark-ai/types";

/**
 * On-device filtering for the Ongoing (live tabs) view.
 *
 * Purely client-side by design: the live mirror already sits in memory as one
 * whole `ListLiveResponse` snapshot, re-pushed over SSE on every change — so
 * filtering is a memo over the CURRENT snapshot, never a request, and a new
 * snapshot re-runs it with the query still applied. Nothing here is indexed or
 * cached: the live schema bounds a device at 12 windows × 100 tabs, so the plain
 * scans below cost less than any structure that would replace them.
 *
 * The same semantics are implemented for mobile in
 * `apps/mobile/src/lib/live-filter.ts` — keep the two in step: terms are the
 * lowercased whitespace-split query, and a tab matches when EVERY term is a
 * substring of `title + " " + url`.
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
 * reference) when nothing is being filtered, so the no-query path allocates
 * nothing and re-renders exactly as it did before this feature existed.
 *
 * Note this narrows what's DISPLAYED only: callers keep the untouched `win` for
 * anything that acts on the window as a whole (saving it as a session), so a
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
 * SAME array when there are no terms. Freshness grouping (fresh vs. folded-away
 * "older" devices) is the caller's business — a matching tab on a quiet device
 * still has to be reachable, so the view unfolds that group while a query is on.
 */
export function filterLiveDevices(devices: LiveDevice[], terms: string[]): LiveDevice[] {
  if (terms.length === 0) return devices;
  return devices.filter((device) => deviceMatchCount(device, terms) > 0);
}

/** Total matching tabs across a device list — the "N matching tabs" hint. */
export function totalMatchCount(devices: LiveDevice[], terms: string[]): number {
  return devices.reduce((sum, device) => sum + deviceMatchCount(device, terms), 0);
}
