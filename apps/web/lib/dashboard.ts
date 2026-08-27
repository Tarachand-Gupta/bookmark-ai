import type { Bookmark, DashboardActivity, LiveDevice } from "@bookmark-ai/types";

/**
 * Framework-free logic behind the dashboard's four cards. Pure functions on
 * purpose: the two genuinely non-obvious rules on the page (which live devices
 * count as "live now", and how the cross-device saves fold into Recent saves)
 * are unit-tested rather than eyeballed.
 *
 * Live ordering happens CLIENT-side, not in /api/dashboard, because live state
 * comes from a separate server this app can't proxy the caller's credentials to.
 */

/** localStorage key for the stale-while-revalidate snapshot of the last payload. */
export const DASHBOARD_SNAPSHOT_KEY = "bmk:dashboard-snapshot";
/** localStorage key remembering that the setup card was dismissed. */
export const SETUP_DISMISSED_KEY = "bmk:dashboard-setup-dismissed";
/** localStorage key remembering that the MCP promo is settled for this account —
 * written both when the user dismisses the card and when we find they already
 * have a live MCP token (see useMcpPromo: it's also what keeps that lookup from
 * repeating on every visit). */
export const MCP_PROMO_DISMISSED_KEY = "bmk:dashboard-mcp-dismissed";
/** localStorage key remembering that the "Install the extension" grid card was
 * dismissed. Separate from the detection memo in lib/extension-detect.ts: that
 * one records what we FOUND, this one records what the user decided. */
export const EXTENSION_CARD_DISMISSED_KEY = "bmk:dashboard-extension-dismissed";
/** localStorage key remembering that the "Get the mobile app" card was dismissed
 * — on mobile web this doubles as the "I already have it" signal, because there
 * is no API that can tell us whether a native app is installed. */
export const MOBILE_APP_DISMISSED_KEY = "bmk:dashboard-mobile-app-dismissed";

/** A live device stops being a resume candidate once it's this stale (24h). */
export const LIVE_CANDIDATE_MAX_AGE_SECONDS = 24 * 60 * 60;
/** Under 10 min since the last check-in reads as "Active now" (matches the live
 * view's own FRESH_MAX_SECONDS). */
export const LIVE_ACTIVE_MAX_AGE_SECONDS = 600;
/** Freshness bucket for ranking live devices against each other: two devices
 * whose last check-ins land in the same 5-minute bucket are equally "here right
 * now", so raw `lastSeenAgeSeconds` ordering between them is noise (the heartbeat
 * interval, not user intent). Inside a bucket the busier device wins. */
export const LIVE_FRESHNESS_BUCKET_SECONDS = 300;

/** Hard ceiling on a page-side "open all" — a runaway loop of window.open is
 * both popup-blocked and hostile. */
export const OPEN_TABS_MAX = 10;
/** Above this many tabs, ask first. */
export const OPEN_TABS_CONFIRM_OVER = 5;

/** "Active now" / "Active 20 min ago" / "Earlier today" / "2 days ago". */
export function liveAgeLabel(seconds: number): string {
  if (seconds < LIVE_ACTIVE_MAX_AGE_SECONDS) return "Active now";
  if (seconds < 3600) return `Active ${Math.round(seconds / 60)} min ago`;
  if (seconds < 6 * 3600) {
    const h = Math.round(seconds / 3600);
    return `Active ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (seconds < LIVE_CANDIDATE_MAX_AGE_SECONDS) return "Earlier today";
  const d = Math.max(1, Math.round(seconds / 86400));
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Relative save/capture time for a row: "just now", "12m", "3h", "5d", or a date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Which freshness bucket a live device falls in (0 = seen within the last
 * bucket). Bucketing rather than comparing ages pairwise keeps the sort a proper
 * total order, so the ranking is stable/transitive. */
function freshnessBucket(device: LiveDevice): number {
  return Math.floor(device.lastSeenAgeSeconds / LIVE_FRESHNESS_BUCKET_SECONDS);
}

/**
 * Which devices the "Live now" card is allowed to call live, best first.
 *
 * Filters: a device that hasn't checked in for 24h isn't "now", and a device
 * with zero open tabs has nothing to hand off — neither earns a row. A device
 * can also appear twice in one snapshot while it re-announces, so ids are
 * de-duped before anything else.
 *
 * Order: freshest BUCKET first (see LIVE_FRESHNESS_BUCKET_SECONDS), then most
 * open tabs, then raw age. Two laptops that both checked in a minute ago are
 * equally live, and the one holding 20 tabs is the one you left mid-task.
 *
 * `null` in (live off / unreachable) is an empty list out — the card renders its
 * own quiet empty state rather than guessing.
 */
export function rankLiveDevices(devices: LiveDevice[] | null): LiveDevice[] {
  const seen = new Set<string>();
  return (devices ?? [])
    .filter((d) => {
      if (d.lastSeenAgeSeconds >= LIVE_CANDIDATE_MAX_AGE_SECONDS || d.tabCount === 0) return false;
      if (seen.has(d.deviceId)) return false;
      seen.add(d.deviceId);
      return true;
    })
    .sort(
      (a, b) =>
        freshnessBucket(a) - freshnessBucket(b) ||
        b.tabCount - a.tabCount ||
        a.lastSeenAgeSeconds - b.lastSeenAgeSeconds,
    );
}

/**
 * What the Recent saves card lists. The old dashboard gave "saved on another
 * device" a card of its own, which meant one save could appear twice under two
 * different headings; folding the two lists into ONE newest-first stream (the
 * row itself carries the device it came from) is the same information with one
 * less thing to read.
 *
 * De-duped by id — `otherDeviceBookmarks` is a filtered slice of the same table
 * `recentBookmarks` comes from, so overlap is the normal case, not an edge one.
 */
export function mergeRecentSaves(
  recent: Bookmark[],
  otherDevice: Bookmark[],
  limit: number,
): Bookmark[] {
  const byId = new Map<string, Bookmark>();
  for (const b of [...recent, ...otherDevice]) {
    if (!byId.has(b.id)) byId.set(b.id, b);
  }
  return [...byId.values()]
    .sort((a, b) => savedAtMs(b) - savedAtMs(a))
    .slice(0, limit);
}

/** `savedAt` for ordering. Unparseable timestamps sort last rather than throwing
 * NaN through the comparator (which would leave the list in engine order). */
function savedAtMs(b: Bookmark): number {
  const t = new Date(b.source.savedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Whether the Activity card has anything to draw.
 *
 * Activity is the ONE card on this page allowed to disappear (see
 * docs/features/dashboard.md §3.2 — Tara's 2026-08-27 override of the
 * fixed-grid rule). The rule is deliberately narrow and reads off the payload
 * shape rather than a vibe: the server sends `activity: null` below
 * ACTIVITY_MIN_BOOKMARKS, and above that floor it still sends a fully
 * zero-filled 14-day window — an account whose saves are all older than the
 * window gets 14 zero buckets, i.e. a sparkline of nothing. Both cases are "no
 * activity".
 *
 * `topCategories`/`browserSplit` are ALL-TIME facets, so they can be non-empty
 * while the window is empty; they are not part of this test, because a card
 * whose headline chart is blank is not worth a grid slot for its footnotes.
 */
export function hasDashboardActivity(activity: DashboardActivity | null | undefined): boolean {
  if (!activity) return false;
  return activity.days.some((d) => d.count > 0);
}

/** The bits of `navigator` the platform check reads — narrow on purpose so the
 * rule is unit-testable against a plain object. `userAgentData` is Chromium-only
 * and still not in every lib.dom, hence the local shape. */
export interface PlatformNavigator {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
}

/**
 * Is this a phone or a tablet? Coarse and safe by design — it only decides
 * WHICH install nudge to show (browser extension vs. the mobile app), so the
 * cost of a wrong answer is one irrelevant card, not a broken page.
 *
 * Three signals, OR'd, positives only:
 *  1. `navigator.userAgentData.mobile === true` — Chromium's own answer.
 *  2. an Android / iPhone / iPod / iPad user agent.
 *  3. iPadOS's *desktop* UA, which says "Macintosh" and nothing else: a real Mac
 *     reports `maxTouchPoints === 0`, an iPad reports 5.
 *
 * `userAgentData.mobile === false` is deliberately NOT treated as a final "no":
 * it is false on Android tablets, which have no extension story at all, so
 * trusting it there would offer a Chrome-Web-Store button to a browser that
 * cannot install one. Signal 2 catches those.
 */
export function isMobilePlatform(nav: PlatformNavigator | null | undefined): boolean {
  if (!nav) return false;
  if (nav.userAgentData?.mobile === true) return true;
  const ua = nav.userAgent ?? "";
  if (/android|iphone|ipod|ipad/i.test(ua)) return true;
  return /macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export interface OpenPlan {
  /** The URLs that will actually be opened (capped, http(s) only). */
  urls: string[];
  /** How many were dropped by the cap. */
  skipped: number;
  /** The caller must confirm() before opening this many tabs. */
  needsConfirm: boolean;
}

/**
 * What a page-side "open all" is allowed to do: http(s) only, at most
 * OPEN_TABS_MAX, and a confirmation past OPEN_TABS_CONFIRM_OVER so a stray click
 * can't blow up someone's window with ten tabs.
 */
export function planTabOpen(urls: string[]): OpenPlan {
  const openable = urls.filter((u) => /^https?:/i.test(u));
  const capped = openable.slice(0, OPEN_TABS_MAX);
  return {
    urls: capped,
    skipped: openable.length - capped.length,
    needsConfirm: capped.length > OPEN_TABS_CONFIRM_OVER,
  };
}
