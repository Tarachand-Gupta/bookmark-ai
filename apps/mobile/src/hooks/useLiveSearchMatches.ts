import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveDevice, LiveTab } from "@bookmark-ai/types";
import { listLiveDevices } from "../api";
import { usePreferences } from "../context/PreferencesContext";
import { deviceDisplayLabel } from "../lib/live";

/** One window's worth of matches — carries the RESOLVED label (the user's
 * window name, or the positional "Window N" fallback) because that same
 * string doubles as part of what a tab is matched against (see
 * `computeMatches`), so the UI and the match logic never disagree about what
 * a window is "called". */
export interface LiveWindowMatchGroup {
  windowId: number;
  windowLabel: string;
  /** Only the tabs in this window that matched every search term. */
  tabs: LiveTab[];
}

/** One device's matches — the unit the Sessions segment renders a card for. */
export interface LiveDeviceMatchGroup {
  deviceId: string;
  deviceLabel: string;
  windows: LiveWindowMatchGroup[];
}

export interface LiveSearchMatches {
  /** Device → window → matching tabs, already pruned of empty windows/devices
   * (a device/window with zero matching tabs never appears here). */
  groups: LiveDeviceMatchGroup[];
  /** Total matching TABS across every group — what this feature adds to the
   * Sessions segment's badge count. */
  matchCount: number;
}

const EMPTY: LiveSearchMatches = { groups: [], matchCount: 0 };

/** How long a fetched device list is reused across successive queries (see below). */
const FETCH_FRESHNESS_MS = 20_000;

/**
 * Client-side search over the tabs a device is CURRENTLY mirroring — never
 * saved anywhere — layered on top of useSearch's bookmark/session results as
 * a purely optional extra source of matches. Two things this deliberately
 * does NOT do, both to keep it simple and cheap:
 *
 *  - No SSE stream. useLiveDevices holds one open for the whole time the user
 *    sits on the Sessions tab's Live segment; here a one-shot GET per
 *    debounced query (the same 350ms cadence useSearch uses for bookmarks) is
 *    plenty fresh for a search result and avoids a second live connection
 *    just to power search-as-you-type.
 *  - No server-side filtering. The match itself is a cheap client-side memo
 *    over whichever device list was last fetched, so it re-runs on every
 *    keystroke instantly instead of waiting on the next debounced fetch.
 *
 * Live is OPTIONAL EVERYWHERE: any failure — offline, live disabled,
 * ProvisioningError, ForbiddenError, no devices at all — is swallowed to the
 * empty result. This must never surface an error or block the bookmark/session
 * results rendered right next to it (mirrors the "keep last-known, never hard
 * fail" spirit of useLiveDevices, minus the parts of that hook — the stream,
 * the provisioning/error UI states — that only make sense for a dedicated
 * screen the user is deliberately looking at).
 */
export function useLiveSearchMatches(query: string): LiveSearchMatches {
  // `serverTarget` never actually changes within a running app (it's a
  // build-time constant re-exposed for formality — see PreferencesContext),
  // but every other search-ish effect lists it as a dependency, so this one
  // does too for consistency should that ever stop being true.
  const { serverTarget } = usePreferences();
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const runId = useRef(0);
  const fetchedAt = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    const q = query.trim();
    // Nothing to search yet. Deliberately leave `devices` as-is rather than
    // clearing it — harmless, since `computeMatches` below yields `EMPTY` for
    // a blank query regardless of what's cached, and it saves a re-fetch the
    // instant the user resumes typing.
    if (!q) return;
    // ONE fetch per search, not one per query refinement: the mirror is a set of
    // open tabs, which barely changes while someone types a few more letters, and
    // the request leaves for a separate live service. Refining "rust" → "rust
    // async" therefore re-filters the CACHED device list (the memo below) instead
    // of asking again; a genuinely later search gets a fresh list. `fetchedAt` is
    // stamped on failure too, so a disabled/unreachable live server is tried once
    // per window rather than once per keystroke.
    if (Date.now() - fetchedAt.current < FETCH_FRESHNESS_MS) return;
    const timer = setTimeout(() => {
      fetchedAt.current = Date.now();
      listLiveDevices()
        .then((data) => {
          if (runId.current === id) setDevices(data.devices);
        })
        .catch((err: unknown) => {
          // Swallowed by design — see the doc comment above. Logged only for
          // whoever is debugging why live matches aren't showing up.
          console.warn(
            "[live-search] unreachable, dropping live matches:",
            err instanceof Error ? err.message : String(err),
          );
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, serverTarget]);

  return useMemo(() => computeMatches(devices, query), [devices, query]);
}

/** Tokenize on whitespace, lowercase, drop empties — a per-term AND match,
 * same shape as how a person reads a multi-word search. */
function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * A tab matches when EVERY term is a substring of (tab title + tab URL + its
 * window's resolved name/label), case-insensitively. Devices/windows/tabs are
 * already bounded by the live schema (≤12 windows, ≤100 tabs each per
 * device), so this plain nested loop never has to worry about unbounded work.
 */
function computeMatches(devices: LiveDevice[], query: string): LiveSearchMatches {
  const terms = tokenize(query);
  if (terms.length === 0) return EMPTY;

  const groups: LiveDeviceMatchGroup[] = [];
  let matchCount = 0;

  for (const device of devices) {
    const windows: LiveWindowMatchGroup[] = [];
    device.windows.forEach((win, index) => {
      const windowLabel = win.name?.trim() || `Window ${index + 1}`;
      const tabs = win.tabs.filter((tab) => {
        const haystack = `${tab.title} ${tab.url} ${windowLabel}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      if (tabs.length > 0) windows.push({ windowId: win.windowId, windowLabel, tabs });
    });
    if (windows.length > 0) {
      groups.push({ deviceId: device.deviceId, deviceLabel: deviceDisplayLabel(device), windows });
      matchCount += windows.reduce((sum, w) => sum + w.tabs.length, 0);
    }
  }

  return { groups, matchCount };
}
