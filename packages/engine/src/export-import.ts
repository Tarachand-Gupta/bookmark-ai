import { randomUUID } from "node:crypto";
import {
  createSession,
  insertBookmark,
  type Db,
} from "@bookmark-ai/db";
import {
  migrateExportBundle,
  SCHEMA_VERSION,
  type Browser,
  type DeviceType,
  type ExportBundle,
  type ExportedBookmark,
  type ExportedSession,
  type OpenGraph,
  type SessionTab,
} from "@bookmark-ai/types";

/** Options for {@link importUserData}. Reserved for future tuning (none yet). */
export type ImportUserDataOptions = Record<string, never>;

/**
 * Export every bookmark and session in a tenant DB as a versioned, lossless
 * bundle. Reads ALL rows (no list caps) and every persisted column EXCEPT the
 * `embedding` blob — that is regenerable and left out to keep bundles small.
 * `exportedAt` is passed in by the caller (some runtimes lack a stable clock
 * at call sites; the route stamps it). Timestamps are copied verbatim.
 */
export async function exportUserData(db: Db, exportedAt: string): Promise<ExportBundle> {
  const [bookmarkRows, sessionRows] = await Promise.all([
    db.execute(`
      SELECT url, domain, title, description, og_json, browser, device,
             device_name, os, saved_at, saved_day, category, tags_json, created_at
      FROM bookmarks
      ORDER BY created_at ASC
    `),
    db.execute(`
      SELECT name, tabs_json, tab_count, browser, device, saved_at, created_at
      FROM sessions
      ORDER BY created_at ASC
    `),
  ]);

  const bookmarks: ExportedBookmark[] = bookmarkRows.rows.map((r) => ({
    url: String(r.url),
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    category: String(r.category),
    tags: parseStringArray(r.tags_json),
    browser: String(r.browser),
    device: String(r.device),
    deviceName: (r.device_name as string | null) ?? null,
    os: (r.os as string | null) ?? null,
    domain: String(r.domain),
    ogJson: (r.og_json as string | null) ?? "{}",
    savedAt: String(r.saved_at),
    savedDay: String(r.saved_day),
    createdAt: String(r.created_at),
  }));

  const sessions: ExportedSession[] = sessionRows.rows.map((r) => ({
    name: String(r.name),
    tabs: parseTabs(r.tabs_json),
    tabCount: Number(r.tab_count ?? 0),
    browser: String(r.browser),
    device: String(r.device),
    savedAt: String(r.saved_at),
    createdAt: String(r.created_at),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    counts: { bookmarks: bookmarks.length, sessions: sessions.length },
    bookmarks,
    sessions,
  };
}

/**
 * Import a bundle produced by {@link exportUserData} into a tenant DB. The bundle
 * is validated and upgraded via `migrateExportBundle` first. Bookmarks upsert by
 * URL and sessions dedup by saved_at + name, so re-importing the same file is
 * idempotent. Original savedAt / savedDay / createdAt are preserved — nothing is
 * stamped "now" (that is the whole point of a lossless import). Uses the
 * lower-level `insertBookmark`/`createSession` query helpers, which take explicit
 * timestamps rather than generating them (unlike saveBookmarkFast/saveSession).
 * Embeddings are intentionally left null so the existing embed sweep refills them.
 * Returns how many of each were imported.
 */
export async function importUserData(
  db: Db,
  bundle: unknown,
  _opts?: ImportUserDataOptions,
): Promise<{ bookmarks: number; sessions: number }> {
  const migrated = migrateExportBundle(bundle);

  let bookmarks = 0;
  for (const b of migrated.bookmarks) {
    // insertBookmark derives saved_day from source.savedAt.slice(0,10) — the
    // same rule that produced the exported savedDay, so it round-trips exactly.
    await insertBookmark(db, {
      id: randomUUID(),
      url: b.url,
      domain: b.domain,
      title: b.title,
      description: b.description,
      og: parseOpenGraph(b.ogJson),
      source: {
        browser: b.browser as Browser,
        device: b.device as DeviceType,
        deviceName: b.deviceName,
        os: b.os,
        savedAt: b.savedAt,
      },
      category: b.category,
      tags: b.tags,
      createdAt: b.createdAt,
    });
    bookmarks++;
  }

  let sessions = 0;
  for (const s of migrated.sessions) {
    // Sessions have no natural unique key like a bookmark's URL, so to keep
    // re-import idempotent (import the same file twice → no duplicates) we key
    // on saved_at + name: a millisecond timestamp plus name uniquely identifies
    // an exported session, so a re-import matches and skips the insert.
    const existing = await db.execute({
      sql: `SELECT id FROM sessions WHERE saved_at = ? AND name = ? LIMIT 1`,
      args: [s.savedAt, s.name],
    });
    if (existing.rows.length === 0) {
      await createSession(db, {
        id: randomUUID(),
        name: s.name,
        tabs: s.tabs,
        browser: s.browser,
        device: s.device,
        savedAt: s.savedAt,
        createdAt: s.createdAt,
      });
    }
    sessions++;
  }

  return { bookmarks, sessions };
}

function parseStringArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseTabs(raw: unknown): SessionTab[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? (parsed as SessionTab[]) : [];
  } catch {
    return [];
  }
}

function parseOpenGraph(raw: string): OpenGraph {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OpenGraph) : {};
  } catch {
    return {};
  }
}
