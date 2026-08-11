import type { Session, SessionTab } from "@bookmark-ai/types";
import type { Db } from "../client";

export interface InsertSession {
  id: string;
  name: string;
  tabs: SessionTab[];
  browser: string;
  device: string;
  os: string | null;
  /** AI summary, when one already exists (an import carries it); a fresh save
   * inserts null and the post-response enrichment fills it in. */
  description?: string | null;
  savedAt: string;
  createdAt: string;
}

/** Save a snapshot of open tabs as a named session. */
export async function createSession(db: Db, s: InsertSession): Promise<Session> {
  await db.execute({
    sql: `INSERT INTO sessions (id, name, tabs_json, tab_count, browser, device, os, description, saved_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      s.id,
      s.name,
      JSON.stringify(s.tabs),
      s.tabs.length,
      s.browser,
      s.device,
      s.os,
      s.description ?? null,
      s.savedAt,
      s.createdAt,
    ],
  });
  const saved = await getSession(db, s.id);
  if (!saved) throw new Error("createSession: row not found after insert");
  return saved;
}

export async function listSessions(db: Db): Promise<Session[]> {
  // Newest first by created_at — the server-stamped insert time — NOT saved_at.
  // saved_at is client/capture-supplied (the extension uses the device clock, and
  // a session saved from a live capture can inherit an older/ahead capture time),
  // so ordering by it can bury a just-saved session behind older rows. created_at
  // is always `now` at insert, so a fresh save always sorts first. saved_at breaks
  // ties for any legacy rows that share a created_at.
  const rs = await db.execute(
    "SELECT * FROM sessions ORDER BY created_at DESC, saved_at DESC LIMIT 200",
  );
  return rs.rows.map((r) => rowToSession(r as unknown as Record<string, unknown>));
}

export async function getSession(db: Db, id: string): Promise<Session | null> {
  const rs = await db.execute({ sql: "SELECT * FROM sessions WHERE id = ?", args: [id] });
  const row = rs.rows[0];
  return row ? rowToSession(row as unknown as Record<string, unknown>) : null;
}

/** Rename a saved session. Returns the updated session, or null if no such id. */
export async function renameSession(db: Db, id: string, name: string): Promise<Session | null> {
  const rs = await db.execute({
    sql: "UPDATE sessions SET name = ? WHERE id = ?",
    args: [name, id],
  });
  if (rs.rowsAffected === 0) return null;
  return getSession(db, id);
}

/**
 * Persist an AI summary onto a saved session: the `description` always, and the
 * `name` only when one is passed (the post-save path leaves a user-typed name
 * alone — see `isAutoSessionName` in packages/engine). Returns the updated
 * session, or null if the row is gone (concurrent delete).
 */
export async function applySessionSummary(
  db: Db,
  id: string,
  summary: { name?: string; description: string | null },
): Promise<Session | null> {
  const setName = typeof summary.name === "string";
  const rs = await db.execute({
    sql: setName
      ? "UPDATE sessions SET name = ?, description = ? WHERE id = ?"
      : "UPDATE sessions SET description = ? WHERE id = ?",
    args: setName
      ? [summary.name as string, summary.description, id]
      : [summary.description, id],
  });
  if (rs.rowsAffected === 0) return null;
  return getSession(db, id);
}

export async function deleteSession(db: Db, id: string): Promise<boolean> {
  const rs = await db.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

/**
 * Case-insensitive substring search over session names, the AI-written
 * `description`, and tab text (titles + URLs live in tabs_json). Sessions are
 * capped at 200 rows, so LIKE is plenty; a name-or-description hit outranks a
 * tabs-only hit.
 *
 * The description is a first-class match target because it is often the ONLY
 * place a session's actual subject is written down: names default to a device +
 * timestamp, and the tabs themselves are URLs and page titles, so "the research
 * on rust async runtimes" only matches the summary. Description hits share the
 * name tier — a summary hit is about the session as a whole, exactly like its
 * name, and clients treat both the same (a card with no matching TAB doesn't
 * fold its tab list). NULL descriptions (pre-v12 rows, or a session whose
 * summary hasn't been generated yet) behave exactly as they did: `NULL LIKE ?`
 * is NULL, which SQLite treats as false in a WHERE, and the COALESCE below
 * pins it to 0 in the SELECT so the rank flag is never NULL.
 */
export async function searchSessions(
  db: Db,
  q: string,
  limit: number,
): Promise<{ session: Session; score: number }[]> {
  // Escape LIKE wildcards in user text; \ is the escape char below. Every
  // comparison is a bound parameter — user text is NEVER interpolated into SQL.
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  const rs = await db.execute({
    // `session_hit` = the query matched the session ITSELF (name or summary)
    // rather than only one of its tabs — the two-tier rank the caller scores on.
    sql: `SELECT *,
                 (name LIKE ? ESCAPE '\\'
                  OR COALESCE(description LIKE ? ESCAPE '\\', 0)) AS session_hit
          FROM sessions
          WHERE name LIKE ? ESCAPE '\\'
             OR COALESCE(description LIKE ? ESCAPE '\\', 0)
             OR tabs_json LIKE ? ESCAPE '\\'
          ORDER BY session_hit DESC, created_at DESC, saved_at DESC
          LIMIT ?`,
    args: [pattern, pattern, pattern, pattern, pattern, limit],
  });
  return rs.rows.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return { session: rowToSession(row), score: Number(row.session_hit) ? 2 : 1 };
  });
}

function rowToSession(row: Record<string, unknown>): Session {
  const tabs = parseTabs(row.tabs_json);
  return {
    id: String(row.id),
    name: String(row.name),
    tabs,
    tabCount: Number(row.tab_count ?? tabs.length),
    description: (row.description as string | null) ?? null,
    browser: String(row.browser) as Session["browser"],
    device: String(row.device) as Session["device"],
    os: (row.os as string | null) ?? null,
    savedAt: String(row.saved_at),
    createdAt: String(row.created_at),
  };
}

function parseTabs(raw: unknown): SessionTab[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? (parsed as SessionTab[]) : [];
  } catch {
    return [];
  }
}
