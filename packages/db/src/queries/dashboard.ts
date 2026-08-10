import type { Bookmark, DashboardSessionTab, SessionSummary } from "@bookmark-ai/types";
import type { Db } from "../client";
import { BOOKMARK_COLUMNS, rowToBookmark } from "../rows";

/**
 * The narrow, single-purpose reads behind GET /api/dashboard. Each one is a
 * single cheap statement (indexed scan or a GROUP BY over one column) so the
 * whole landing page is one parallel burst — see `getDashboard` in
 * packages/engine/src/dashboard.ts, which is the only caller.
 *
 * These deliberately do NOT reuse `listBookmarks`/`listSessions`: the dashboard
 * needs an OR-of-tags filter, a device-NOT-EQUALS filter, and session rows
 * WITHOUT their (potentially 500-tab) `tabs_json` payload — none of which the
 * library's list queries express.
 */

export async function countBookmarks(db: Db): Promise<number> {
  const rs = await db.execute("SELECT count(*) AS n FROM bookmarks");
  return Number(rs.rows[0]?.n ?? 0);
}

export async function countSessions(db: Db): Promise<number> {
  const rs = await db.execute("SELECT count(*) AS n FROM sessions");
  return Number(rs.rows[0]?.n ?? 0);
}

/**
 * Newest bookmarks whose `tags_json` array contains ANY of `tags` (the reading
 * queue: `reading` OR `article`), plus the total match count. Tags are stored
 * lowercased, so callers must pass lowercase.
 */
export async function listBookmarksByAnyTag(
  db: Db,
  tags: string[],
  limit: number,
): Promise<{ items: Bookmark[]; total: number }> {
  if (tags.length === 0) return { items: [], total: 0 };
  const placeholders = tags.map(() => "?").join(", ");
  // EXISTS + json_each mirrors listBookmarks' single-tag filter, widened to a set.
  const where = `WHERE EXISTS (
    SELECT 1 FROM json_each(bookmarks.tags_json)
    WHERE json_each.value IN (${placeholders})
  )`;
  const [rows, count] = await Promise.all([
    db.execute({
      sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks ${where}
            ORDER BY saved_at DESC LIMIT ?`,
      args: [...tags, limit],
    }),
    db.execute({ sql: `SELECT count(*) AS n FROM bookmarks ${where}`, args: tags }),
  ]);
  return {
    items: rows.rows.map(rowToBookmark),
    total: Number(count.rows[0]?.n ?? 0),
  };
}

/**
 * Newest bookmarks saved from a device class OTHER than `device` — the
 * cross-device "you saved this elsewhere" fallback for the Continue card.
 */
export async function listBookmarksNotFromDevice(
  db: Db,
  device: string,
  limit: number,
): Promise<Bookmark[]> {
  const rs = await db.execute({
    sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE device <> ?
          ORDER BY saved_at DESC LIMIT ?`,
    args: [device, limit],
  });
  return rs.rows.map(rowToBookmark);
}

/** Newest saved sessions as summaries — `tabs_json` is NOT selected. */
export async function listRecentSessionSummaries(
  db: Db,
  limit: number,
): Promise<SessionSummary[]> {
  // Same ordering as listSessions: created_at (server-stamped) first, because
  // saved_at is client-clock and can bury a just-saved session.
  const rs = await db.execute({
    sql: `SELECT id, name, tab_count, browser, device, os, saved_at
          FROM sessions ORDER BY created_at DESC, saved_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    tabCount: Number(r.tab_count ?? 0),
    browser: String(r.browser) as SessionSummary["browser"],
    device: String(r.device) as SessionSummary["device"],
    os: (r.os as string | null) ?? null,
    savedAt: String(r.saved_at),
  }));
}

/**
 * The newest saved session's first `limit` tabs — the payload behind the hero
 * card's "Open all in new window". Only the fields an open needs (url, title,
 * favicon), never a whole Session.
 */
export async function getLatestSessionTabs(
  db: Db,
  limit: number,
): Promise<{ id: string; tabs: DashboardSessionTab[] } | null> {
  const rs = await db.execute(
    "SELECT id, tabs_json FROM sessions ORDER BY created_at DESC, saved_at DESC LIMIT 1",
  );
  const row = rs.rows[0];
  if (!row) return null;
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(String(row.tabs_json ?? "[]"));
  } catch {
    parsed = [];
  }
  const tabs = Array.isArray(parsed) ? parsed : [];
  return {
    id: String(row.id),
    tabs: tabs.slice(0, limit).map((t) => {
      const tab = (t ?? {}) as { url?: unknown; title?: unknown; favIconUrl?: unknown };
      return {
        url: String(tab.url ?? ""),
        title: typeof tab.title === "string" ? tab.title : undefined,
        favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : null,
      };
    }),
  };
}

export interface ActivityCounts {
  /** Saves per stored `saved_day` from `sinceDay` (inclusive) onward, ascending. */
  days: { day: string; count: number }[];
  /** Every category, descending by count. */
  categories: { name: string; count: number }[];
  /** Every browser, descending by count. */
  browsers: { name: string; count: number }[];
}

/**
 * The Activity card's three GROUP BYs. `sinceDay` is a YYYY-MM-DD bound compared
 * lexicographically against `saved_day` (text dates sort chronologically), and
 * gaps are zero-filled by the caller — SQL returns only days that have saves.
 */
export async function getActivityCounts(db: Db, sinceDay: string): Promise<ActivityCounts> {
  const [days, categories, browsers] = await Promise.all([
    db.execute({
      sql: `SELECT saved_day AS day, count(*) AS count FROM bookmarks
            WHERE saved_day >= ? GROUP BY saved_day ORDER BY day`,
      args: [sinceDay],
    }),
    db.execute(
      "SELECT category AS name, count(*) AS count FROM bookmarks GROUP BY category ORDER BY count DESC, name",
    ),
    db.execute(
      "SELECT browser AS name, count(*) AS count FROM bookmarks GROUP BY browser ORDER BY count DESC, name",
    ),
  ]);
  return {
    days: days.rows.map((r) => ({ day: String(r.day), count: Number(r.count) })),
    categories: categories.rows.map((r) => ({ name: String(r.name), count: Number(r.count) })),
    browsers: browsers.rows.map((r) => ({ name: String(r.name), count: Number(r.count) })),
  };
}
