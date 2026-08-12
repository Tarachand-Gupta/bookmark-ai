import type { Session, SessionTab } from "@bookmark-ai/types";
import type { Db } from "../client";
import { MIN_VECTOR_SIMILARITY } from "./search";

/**
 * Every `sessions` column that maps onto the shared `Session` shape — i.e. all
 * of them EXCEPT the `embedding` blob (added in migration v13). Spelled out
 * rather than `SELECT *` because that blob is 768 floats per row and the list
 * endpoints read up to 200 rows: shipping it would add megabytes to a response
 * nothing can use (unlike bookmarks, `Session` exposes no `embedded` flag).
 */
const SESSION_COLUMNS =
  "id, name, tabs_json, tab_count, browser, device, os, description, saved_at, created_at";

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
    `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY created_at DESC, saved_at DESC LIMIT 200`,
  );
  return rs.rows.map((r) => rowToSession(r as unknown as Record<string, unknown>));
}

export async function getSession(db: Db, id: string): Promise<Session | null> {
  const rs = await db.execute({
    sql: `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`,
    args: [id],
  });
  const row = rs.rows[0];
  return row ? rowToSession(row as unknown as Record<string, unknown>) : null;
}

/**
 * Rename a saved session. Returns the updated session, or null if no such id.
 *
 * Clears `embedding`: the name is part of the embedded text, so the stored
 * vector now describes a session that no longer exists. NULL is the
 * "needs embedding" state the sweep looks for — exactly how a re-saved bookmark
 * is re-embedded.
 */
export async function renameSession(db: Db, id: string, name: string): Promise<Session | null> {
  const rs = await db.execute({
    sql: "UPDATE sessions SET name = ?, embedding = NULL WHERE id = ?",
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
 *
 * Clears `embedding` for the same reason `renameSession` does — and it matters
 * MORE here: the description is the richest part of a session's embedded text, so
 * a vector computed before the summary landed is the least useful one. The caller
 * re-embeds immediately after (the post-save `after()`, the Summarize route), and
 * the daily sweep is the backstop.
 */
export async function applySessionSummary(
  db: Db,
  id: string,
  summary: { name?: string; description: string | null },
): Promise<Session | null> {
  const setName = typeof summary.name === "string";
  const rs = await db.execute({
    sql: setName
      ? "UPDATE sessions SET name = ?, description = ?, embedding = NULL WHERE id = ?"
      : "UPDATE sessions SET description = ?, embedding = NULL WHERE id = ?",
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

/** A saved session that matched a search, with its tier/similarity score. */
export interface ScoredSession {
  session: Session;
  /**
   * Text tiers: 2 = the session ITSELF matched (name or summary), 1 = only its
   * tabs did. Semantic hits carry their cosine similarity instead (≤ 1 by
   * construction, and ≥ MIN_VECTOR_SIMILARITY to be returned at all), so a text
   * hit always outranks a vector-only one — the same "incomparable scales, same
   * field" arrangement bookmark results already have (bm25 vs cosine).
   */
  score: number;
  /** Set on a vector-only match: found by meaning, not by any literal term. */
  semantic?: boolean;
}

/** Text scores for the two tiers, so callers/tests don't hard-code 2 and 1. */
export const SESSION_SCORE_SELF = 2;
export const SESSION_SCORE_TABS = 1;

/** Cap on how many terms of a query participate — mirrors `toFtsQuery`'s slice. */
const MAX_SESSION_TERMS = 12;

/** Escape LIKE wildcards so user text can only ever match literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Case-insensitive substring search over session names, the AI-written
 * `description`, and tab text (titles + URLs live in tabs_json). Sessions are
 * capped at 200 rows, so LIKE is plenty; a name-or-description hit outranks a
 * tabs-only hit.
 *
 * PER-TERM, not per-phrase: the query is split on whitespace and EVERY term must
 * appear, ANDed, within a single tier — all terms somewhere in (name OR
 * description) for the session tier, or all terms in tabs_json for the tab tier.
 * A whole-phrase `LIKE %rust async%` (what this used to do) missed
 * "Rust: async runtimes compared" entirely, which is how most people type a
 * remembered subject. Terms are matched independently but the TIER is not mixed:
 * one term from the name plus another from a tab is not a match, because that
 * combination is mostly coincidence at this corpus size.
 *
 * Ordering keeps the two tiers and adds a whole-phrase tiebreak INSIDE the
 * session tier, so an exact "rust async runtimes" in a name still beats a session
 * that merely contains all three words apart.
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
 *
 * Every comparison is a bound parameter — user text is NEVER interpolated into
 * SQL. Only the SHAPE of the clause (one placeholder pair per term) is built by
 * string concatenation.
 */
export async function searchSessions(
  db: Db,
  q: string,
  limit: number,
): Promise<ScoredSession[]> {
  const terms = q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, MAX_SESSION_TERMS)
    .map((t) => `%${escapeLike(t)}%`);
  if (terms.length === 0) return [];
  const phrase = `%${escapeLike(q.trim())}%`;

  // One clause per term, ANDed within each tier.
  const selfClause = terms
    .map(() => "(name LIKE ? ESCAPE '\\' OR COALESCE(description LIKE ? ESCAPE '\\', 0))")
    .join(" AND ");
  const tabsClause = terms.map(() => "tabs_json LIKE ? ESCAPE '\\'").join(" AND ");

  const rs = await db.execute({
    // The flags are computed in a subquery so each LIKE runs once and the outer
    // query can both filter and order on them (`session_hit` = the query matched
    // the session ITSELF rather than only one of its tabs).
    sql: `SELECT * FROM (
            SELECT ${SESSION_COLUMNS},
                   (${selfClause}) AS session_hit,
                   (${tabsClause}) AS tabs_hit,
                   (name LIKE ? ESCAPE '\\'
                    OR COALESCE(description LIKE ? ESCAPE '\\', 0)) AS phrase_hit
            FROM sessions
          )
          WHERE session_hit OR tabs_hit
          ORDER BY session_hit DESC, phrase_hit DESC, created_at DESC, saved_at DESC
          LIMIT ?`,
    args: [
      ...terms.flatMap((t) => [t, t]), // selfClause: name + description per term
      ...terms, // tabsClause
      phrase,
      phrase,
      limit,
    ],
  });
  return rs.rows.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      session: rowToSession(row),
      score: Number(row.session_hit) ? SESSION_SCORE_SELF : SESSION_SCORE_TABS,
    };
  });
}

/**
 * Semantic search over saved sessions — the bookmark `searchVector` shape and
 * scoring, applied to the `sessions.embedding` column added in migration v13,
 * including the same `MIN_VECTOR_SIMILARITY` floor applied IN SQL (see the
 * constant's calibration notes).
 *
 * Sessions whose vector hasn't been computed yet (NULL — a brand-new save, or a
 * rename/summary that invalidated it) are simply absent until the sweep catches
 * up; their text match still works meanwhile.
 */
export async function searchSessionsVector(
  db: Db,
  embedding: number[],
  limit: number,
): Promise<ScoredSession[]> {
  const vector = JSON.stringify(embedding);
  const rs = await db.execute({
    sql: `SELECT ${SESSION_COLUMNS},
                 vector_distance_cos(embedding, vector32(?)) AS distance
          FROM sessions
          WHERE embedding IS NOT NULL
            AND vector_distance_cos(embedding, vector32(?)) <= ?
          ORDER BY distance ASC
          LIMIT ?`,
    args: [vector, vector, 1 - MIN_VECTOR_SIMILARITY, limit],
  });
  return rs.rows.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      session: rowToSession(row),
      score: 1 - Number(row.distance),
      semantic: true,
    };
  });
}

/** Store the embedding for a saved session (marks it searchable by meaning). */
export async function storeSessionEmbedding(
  db: Db,
  id: string,
  embedding: number[],
): Promise<void> {
  await db.execute({
    sql: "UPDATE sessions SET embedding = vector32(?) WHERE id = ?",
    args: [JSON.stringify(embedding), id],
  });
}

/**
 * Sessions still waiting for an embedding (used by the embed sweep) — the
 * `listUnembedded` of the sessions table. Oldest first, same as bookmarks, so a
 * backlog drains in save order rather than starving on the newest rows.
 */
export async function listUnembeddedSessions(db: Db, limit = 20): Promise<Session[]> {
  const rs = await db.execute({
    sql: `SELECT ${SESSION_COLUMNS} FROM sessions
          WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => rowToSession(r as unknown as Record<string, unknown>));
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
