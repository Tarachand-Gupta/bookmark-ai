import type { Session, SessionTab } from "@bookmark-ai/types";
import type { Db } from "../client";

export interface InsertSession {
  id: string;
  name: string;
  tabs: SessionTab[];
  browser: string;
  device: string;
  savedAt: string;
  createdAt: string;
}

/** Save a snapshot of open tabs as a named session. */
export async function createSession(db: Db, s: InsertSession): Promise<Session> {
  await db.execute({
    sql: `INSERT INTO sessions (id, name, tabs_json, tab_count, browser, device, saved_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      s.id,
      s.name,
      JSON.stringify(s.tabs),
      s.tabs.length,
      s.browser,
      s.device,
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

export async function deleteSession(db: Db, id: string): Promise<boolean> {
  const rs = await db.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}

/**
 * Case-insensitive substring search over session names and tab text (titles +
 * URLs live in tabs_json). Sessions are capped at 200 rows, so LIKE is plenty;
 * a name hit outranks a tabs-only hit.
 */
export async function searchSessions(
  db: Db,
  q: string,
  limit: number,
): Promise<{ session: Session; score: number }[]> {
  // Escape LIKE wildcards in user text; \ is the escape char below.
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  const rs = await db.execute({
    sql: `SELECT *, (name LIKE ? ESCAPE '\\') AS name_hit
          FROM sessions
          WHERE name LIKE ? ESCAPE '\\' OR tabs_json LIKE ? ESCAPE '\\'
          ORDER BY name_hit DESC, created_at DESC, saved_at DESC
          LIMIT ?`,
    args: [pattern, pattern, pattern, limit],
  });
  return rs.rows.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return { session: rowToSession(row), score: Number(row.name_hit) ? 2 : 1 };
  });
}

function rowToSession(row: Record<string, unknown>): Session {
  const tabs = parseTabs(row.tabs_json);
  return {
    id: String(row.id),
    name: String(row.name),
    tabs,
    tabCount: Number(row.tab_count ?? tabs.length),
    browser: String(row.browser) as Session["browser"],
    device: String(row.device) as Session["device"],
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
