import type { Db } from "./client";

/**
 * Dimension of stored embedding vectors. Matches Gemini's
 * `gemini-embedding-001` with outputDimensionality=768.
 */
export const EMBEDDING_DIM = 768;

/**
 * Idempotent schema setup: main table, FTS5 index kept in sync by triggers,
 * and a libSQL-native vector column (F32_BLOB) with an ANN index.
 */
export async function ensureSchema(db: Db): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id          TEXT PRIMARY KEY,
      url         TEXT NOT NULL,
      domain      TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      og_json     TEXT NOT NULL DEFAULT '{}',
      browser     TEXT NOT NULL DEFAULT 'other',
      device      TEXT NOT NULL DEFAULT 'other',
      device_name TEXT,
      os          TEXT,
      saved_at    TEXT NOT NULL,
      saved_day   TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'Uncategorized',
      tags_json   TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      embedding   F32_BLOB(${EMBEDDING_DIM})
    );

    CREATE INDEX IF NOT EXISTS idx_bookmarks_saved_day ON bookmarks(saved_day);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_category  ON bookmarks(category);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_browser   ON bookmarks(browser);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_device    ON bookmarks(device);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);

    CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
      id UNINDEXED,
      title,
      description,
      url,
      category,
      tags,
      tokenize = 'porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS bookmarks_ai AFTER INSERT ON bookmarks BEGIN
      INSERT INTO bookmarks_fts (id, title, description, url, category, tags)
      VALUES (new.id, new.title, coalesce(new.description, ''), new.url, new.category, new.tags_json);
    END;

    CREATE TRIGGER IF NOT EXISTS bookmarks_ad AFTER DELETE ON bookmarks BEGIN
      DELETE FROM bookmarks_fts WHERE id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS bookmarks_au AFTER UPDATE ON bookmarks BEGIN
      DELETE FROM bookmarks_fts WHERE id = old.id;
      INSERT INTO bookmarks_fts (id, title, description, url, category, tags)
      VALUES (new.id, new.title, coalesce(new.description, ''), new.url, new.category, new.tags_json);
    END;
  `);

  // Saved browser sessions (a snapshot of open tabs). Standalone table — no
  // FTS/vector machinery; tabs live as JSON. Idempotent, additive.
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      tabs_json  TEXT NOT NULL DEFAULT '[]',
      tab_count  INTEGER NOT NULL DEFAULT 0,
      browser    TEXT NOT NULL DEFAULT 'other',
      device     TEXT NOT NULL DEFAULT 'other',
      saved_at   TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_saved_at ON sessions(saved_at);
  `);

  // ANN index for vector_top_k(). Older libSQL builds without vector support
  // would throw here; queries fall back to brute-force scans anyway.
  try {
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_bookmarks_embedding ON bookmarks(libsql_vector_idx(embedding))",
    );
  } catch (err) {
    // Vector index unavailable — cosine-distance scans still work.
    console.warn(`[db] vector ANN index unavailable: ${(err as Error).message}`);
  }
}
