import type {
  Bookmark,
  DashboardLastSession,
  LiveDevice,
  SessionSummary,
} from "@bookmark-ai/types";

/**
 * Framework-free logic behind the dashboard's "Continue where you left off"
 * hero and its tab-opening actions. Pure functions on purpose: the ranking is
 * the one genuinely non-obvious rule on the page (docs/features/dashboard.md §3.2)
 * and it's unit-tested rather than eyeballed.
 *
 * Ranking happens CLIENT-side, not in /api/dashboard, because the best resume
 * target is usually a live device — and live state comes from a separate server
 * this app can't proxy the caller's credentials to.
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

export type ContinueTarget =
  | {
      kind: "live";
      device: LiveDevice;
      label: string;
      /** Openable http(s) tab URLs across that device's windows. */
      urls: string[];
    }
  | {
      kind: "session";
      session: SessionSummary | null;
      tabs: DashboardLastSession;
      label: string;
    }
  | {
      kind: "bookmarks";
      bookmarks: Bookmark[];
      label: string;
    };

export interface ContinueInputs {
  /** From the live SSE hook; null when live is off/unreachable. */
  liveDevices: LiveDevice[] | null;
  lastSessionTabs: DashboardLastSession | null;
  recentSessions: SessionSummary[];
  otherDeviceBookmarks: Bookmark[];
}

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

/** Only http(s) tabs can be opened; live captures also mark redacted URLs. */
function openableUrls(device: LiveDevice): string[] {
  const urls: string[] = [];
  for (const w of device.windows) {
    for (const tab of w.tabs) {
      if (!tab.redacted && /^https?:/i.test(tab.url)) urls.push(tab.url);
    }
  }
  return urls;
}

/**
 * The ranked resume targets, best first, capped at two (the doc allows a winner
 * plus one runner-up row and no more).
 *
 * 1. A live device seen within the last 24h that actually has openable tabs —
 *    the cross-device handoff, the one thing only this product can offer.
 *    Between live devices: freshest BUCKET first (see
 *    LIVE_FRESHNESS_BUCKET_SECONDS), then most open tabs, then raw age. Two
 *    laptops that both checked in a minute ago are equally live, and the one
 *    holding 20 tabs is the one you left mid-task.
 * 2. Else the newest saved session (restore the whole window).
 * 3. Else the last few saves from another device.
 *
 * Empty array = the card renders nothing (principle 3: no hollow boxes).
 */
export function rankContinueTargets(inputs: ContinueInputs): ContinueTarget[] {
  const out: ContinueTarget[] = [];

  // De-duped by deviceId first: the runner-up row must never be the same target
  // as the winner, and a re-announcing device can appear twice in one snapshot.
  const seenDevices = new Set<string>();
  const liveCandidates = (inputs.liveDevices ?? [])
    .filter((d) => {
      if (d.lastSeenAgeSeconds >= LIVE_CANDIDATE_MAX_AGE_SECONDS || d.tabCount === 0) return false;
      if (seenDevices.has(d.deviceId)) return false;
      seenDevices.add(d.deviceId);
      return true;
    })
    .sort(
      (a, b) =>
        freshnessBucket(a) - freshnessBucket(b) ||
        b.tabCount - a.tabCount ||
        a.lastSeenAgeSeconds - b.lastSeenAgeSeconds,
    );

  for (const device of liveCandidates) {
    out.push({
      kind: "live",
      device,
      label: liveAgeLabel(device.lastSeenAgeSeconds),
      urls: openableUrls(device),
    });
  }

  if (inputs.lastSessionTabs && inputs.lastSessionTabs.tabs.length > 0) {
    const session =
      inputs.recentSessions.find((s) => s.id === inputs.lastSessionTabs!.id) ?? null;
    out.push({
      kind: "session",
      session,
      tabs: inputs.lastSessionTabs,
      label: session ? `Saved ${relativeTime(session.savedAt)}` : "Last saved session",
    });
  }

  if (inputs.otherDeviceBookmarks.length > 0) {
    out.push({
      kind: "bookmarks",
      bookmarks: inputs.otherDeviceBookmarks,
      label: "Saved on another device",
    });
  }

  return out.slice(0, 2);
}

/**
 * Which single tag the reading-queue footer should filter by. The queue is an OR
 * of `reading` and `article` (server-side), but the library filters by ONE tag —
 * so pick whichever the returned items actually carry more of, preferring
 * `reading` on a tie or when neither is present.
 */
export function dominantReadingTag(items: { tags: string[] }[]): "reading" | "article" {
  let reading = 0;
  let article = 0;
  for (const item of items) {
    if (item.tags.includes("reading")) reading++;
    if (item.tags.includes("article")) article++;
  }
  return article > reading ? "article" : "reading";
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
