import type {
  Bookmark,
  DashboardActivity,
  DashboardLastSession,
  DashboardResponse,
  SessionSummary,
} from "@bookmark-ai/types";
import {
  countBookmarks,
  countSessions,
  getActivityCounts,
  getLatestSessionTabs,
  listBookmarks,
  listBookmarksByAnyTag,
  listBookmarksNotFromDevice,
  listRecentSessionSummaries,
  type ActivityCounts,
  type Db,
} from "@bookmark-ai/db";

/**
 * The dashboard aggregator (docs/features/dashboard.md §5): ONE endpoint, one
 * parallel burst of cheap reads, no new columns. Every number here is a starting
 * proposal from the doc, kept as named constants so the cards and the tests agree.
 *
 * Live-device state is deliberately absent — the live server is a separate origin
 * with its own credentials, so clients blend it in after paint (see the web
 * dashboard's use of `useLiveDevices`).
 */

/** Newest saves on the "Recent saves" card. */
export const RECENT_BOOKMARK_LIMIT = 8;
/** Rows in the reading-queue card (the header shows the full count). */
export const READING_QUEUE_LIMIT = 5;
/** Rows on the sessions shelf. */
export const RECENT_SESSION_LIMIT = 4;
/** Tabs returned for the newest session's "Open all". */
export const LAST_SESSION_TAB_LIMIT = 12;
/** Cross-device fallback rows for the Continue card. */
export const OTHER_DEVICE_LIMIT = 3;
/** Below this many bookmarks the Activity card is suppressed entirely (`null`) —
 * a 14-day sparkline over four saves looks broken, not informative. */
export const ACTIVITY_MIN_BOOKMARKS = 20;
/** Sparkline width, in days, inclusive of today. */
export const ACTIVITY_DAYS = 14;
/** Categories shown on the Activity card. */
export const ACTIVITY_TOP_CATEGORIES = 3;
/** The AI/heuristic categorizer's "no idea" bucket — never a "top category". */
export const UNCATEGORIZED = "Uncategorized";
/**
 * Tags that put a bookmark in the reading queue. `reading` + `article` are what
 * the extension's native reading-list sync applies (see createBookmarkSchema.tags).
 */
export const READING_TAGS = ["reading", "article"] as const;

/** YYYY-MM-DD for a Date in UTC — the same key `saved_day` is stored with. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `day` shifted by `delta` calendar days, still YYYY-MM-DD (UTC arithmetic). */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return utcDay(d);
}

/**
 * Expand sparse `{day, count}` rows into EXACTLY `days` consecutive entries
 * ending at `today`, ascending, missing days as 0. Rows outside the window are
 * ignored, so the caller can hand over whatever the query returned.
 */
export function zeroFillDays(
  rows: { day: string; count: number }[],
  opts: { today: string; days: number },
): { day: string; count: number }[] {
  const counts = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  const start = shiftDay(opts.today, -(opts.days - 1));
  for (let i = 0; i < opts.days; i++) {
    const day = shiftDay(start, i);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

/** Top categories by count, dropping the `Uncategorized` bucket. Input is
 * expected to already be count-descending (the query orders it). */
export function topCategories(
  rows: { name: string; count: number }[],
  limit = ACTIVITY_TOP_CATEGORIES,
): { name: string; count: number }[] {
  return rows
    .filter((r) => r.name.trim().toLowerCase() !== UNCATEGORIZED.toLowerCase())
    .slice(0, limit);
}

/** Everything the pure assembler needs — one field per query. */
export interface DashboardParts {
  recentBookmarks: Bookmark[];
  readingQueue: { total: number; items: Bookmark[] };
  recentSessions: SessionSummary[];
  lastSessionTabs: DashboardLastSession | null;
  otherDeviceBookmarks: Bookmark[];
  activityCounts: ActivityCounts;
  totalBookmarks: number;
  totalSessions: number;
}

/**
 * Turn fetched parts into the wire response. Pure and side-effect free (the unit
 * tests drive this directly) — the only judgement it makes is whether the
 * Activity card has enough data to exist.
 */
export function assembleDashboard(
  parts: DashboardParts,
  opts: { today: string },
): DashboardResponse {
  // Anchor the window at the LATEST day we actually have, never earlier than
  // today. `saved_day` is derived from the client's own offset-bearing timestamp,
  // so a user east of UTC legitimately produces a saved_day one calendar day
  // "ahead" of the server's UTC today — anchoring on UTC today alone would drop
  // their newest saves off the end of the sparkline for a few hours each evening.
  const anchor = parts.activityCounts.days.reduce(
    (latest, row) => (row.day > latest ? row.day : latest),
    opts.today,
  );
  const activity: DashboardActivity | null =
    parts.totalBookmarks < ACTIVITY_MIN_BOOKMARKS
      ? null
      : {
          days: zeroFillDays(parts.activityCounts.days, {
            today: anchor,
            days: ACTIVITY_DAYS,
          }),
          topCategories: topCategories(parts.activityCounts.categories),
          browserSplit: parts.activityCounts.browsers,
        };

  return {
    recentBookmarks: parts.recentBookmarks,
    readingQueue: parts.readingQueue,
    recentSessions: parts.recentSessions,
    lastSessionTabs: parts.lastSessionTabs,
    otherDeviceBookmarks: parts.otherDeviceBookmarks,
    activity,
    totalBookmarks: parts.totalBookmarks,
    totalSessions: parts.totalSessions,
  };
}

export interface GetDashboardOptions {
  /** The calling client's own device class, used ONLY to compute
   * `otherDeviceBookmarks`. Absent ⇒ that list is empty. */
  device?: string | null;
  /** Injectable clock (tests). Defaults to now. */
  now?: Date;
}

/** Assemble the whole dashboard payload for one account's DB. */
export async function getDashboard(
  db: Db,
  opts: GetDashboardOptions = {},
): Promise<DashboardResponse> {
  const today = utcDay(opts.now ?? new Date());
  const since = shiftDay(today, -(ACTIVITY_DAYS - 1));
  const device = opts.device?.trim() || null;

  const [
    recent,
    readingQueue,
    recentSessions,
    lastSessionTabs,
    otherDevice,
    activityCounts,
    totalBookmarks,
    totalSessions,
  ] = await Promise.all([
    listBookmarks(db, { limit: RECENT_BOOKMARK_LIMIT, offset: 0 }),
    listBookmarksByAnyTag(db, [...READING_TAGS], READING_QUEUE_LIMIT),
    listRecentSessionSummaries(db, RECENT_SESSION_LIMIT),
    getLatestSessionTabs(db, LAST_SESSION_TAB_LIMIT),
    device
      ? listBookmarksNotFromDevice(db, device, OTHER_DEVICE_LIMIT)
      : Promise.resolve<Bookmark[]>([]),
    getActivityCounts(db, since),
    countBookmarks(db),
    countSessions(db),
  ]);

  return assembleDashboard(
    {
      recentBookmarks: recent.bookmarks,
      readingQueue,
      recentSessions,
      lastSessionTabs,
      otherDeviceBookmarks: otherDevice,
      activityCounts,
      totalBookmarks,
      totalSessions,
    },
    { today },
  );
}
