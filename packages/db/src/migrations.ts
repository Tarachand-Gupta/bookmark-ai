import type { Db } from "./client";

/**
 * Dimension of stored embedding vectors. Matches Gemini's
 * `gemini-embedding-001` with outputDimensionality=768. Lives here (with the
 * baseline DDL that parameterizes it) and is re-exported from schema.ts.
 */
export const EMBEDDING_DIM = 768;

/**
 * One statement in a migration. A bare string is required (a throw aborts the
 * whole migration and its version is NOT recorded, so it re-runs next boot). A
 * `{ sql, tolerant: true }` statement is best-effort: if it throws it is logged
 * and skipped so the rest of the migration — and every later migration — can
 * still be recorded. Use `tolerant` only for optional/degrade-gracefully DDL
 * (e.g. the libSQL vector ANN index, absent on builds without vector support).
 */
export type MigrationStatement = string | { sql: string; tolerant?: boolean };

/** A single versioned migration. Statements run sequentially, in array order. */
export interface Migration {
  version: number;
  name: string;
  statements: MigrationStatement[];
}

/**
 * Tiny self-managed migration runner. Turso deprecated "schema databases", so
 * every DB tracks its own applied versions in `schema_migrations` and pending
 * migrations are applied in ascending version order on first touch after a
 * deploy. Each migration's statements run sequentially; the version row is
 * recorded only after all of its NON-tolerant statements succeed. A `tolerant`
 * statement that throws is warned-and-skipped (it never blocks the version
 * record), so one optional DDL that a libSQL build rejects can't wedge every
 * later migration behind a permanently-pending version. Returns the number applied.
 */
export async function runMigrations(db: Db, migrations: Migration[]): Promise<number> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const done = new Set(
    (await db.execute("SELECT version FROM schema_migrations")).rows.map((r) => Number(r.version)),
  );
  const pending = migrations
    .filter((m) => !done.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    // executeMultiple runs a `;`-separated DDL batch (it tokenizes correctly,
    // so trigger bodies with internal semicolons stay intact).
    for (const statement of migration.statements) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const tolerant = typeof statement !== "string" && statement.tolerant === true;
      if (tolerant) {
        try {
          await db.executeMultiple(sql);
        } catch (err) {
          console.warn(
            `runMigrations: tolerant statement in v${migration.version} (${migration.name}) failed, continuing:`,
            err,
          );
        }
      } else {
        await db.executeMultiple(sql);
      }
    }
    // OR IGNORE: two provisioners can migrate the same fresh tenant DB at once
    // (the user.created webhook racing the request path on a real signup). The
    // DDL above is all IF NOT EXISTS, so the duplicate run is a no-op — but a
    // plain INSERT here would lose the race on the primary key and throw.
    await db.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      args: [migration.version, migration.name, new Date().toISOString()],
    });
  }

  return pending.length;
}

/**
 * The tenant (per-user) schema as versioned migrations. v1 "baseline" is the
 * ENTIRE original schema DDL — fully idempotent (`IF NOT EXISTS` everywhere) so
 * its first run against the pre-existing production DB (which predates
 * `schema_migrations`) is a no-op that just records version 1. Future changes =
 * append a new Migration; never edit v1.
 */
export const TENANT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline",
    statements: [
      `
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
      `,
      `
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
      `,
      // ANN index for vector_top_k(). Needs libSQL vector support, which Turso
      // cloud and @libsql/client (incl. file: mode) both provide. Marked
      // `tolerant` so a libSQL build without vector support degrades to a plain
      // (unindexed) vector scan instead of wedging this and every later migration.
      {
        sql: "CREATE INDEX IF NOT EXISTS idx_bookmarks_embedding ON bookmarks(libsql_vector_idx(embedding))",
        tolerant: true,
      },
    ],
  },
  {
    version: 2,
    name: "user-settings",
    statements: [
      "CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, ai_provider TEXT, ai_base_url TEXT, ai_api_key TEXT, ai_model TEXT, updated_at TEXT NOT NULL)",
    ],
  },
  // Live Sessions ("open tabs"): one ephemeral row per device (windows_json blob),
  // plus the account opt-in flag. Excluded from export and reaped from last_seen_at
  // (no expires_at column, no cron) — so SCHEMA_VERSION stays 1. See §4.2. All bare
  // strings, NOT tolerant: every statement is genuinely idempotent, which matters
  // because runMigrations has no transaction.
  {
    version: 3,
    name: "live-sessions",
    statements: [
      `
        CREATE TABLE IF NOT EXISTS live_devices (
          device_id        TEXT PRIMARY KEY,
          label            TEXT NOT NULL DEFAULT '',
          browser          TEXT NOT NULL DEFAULT 'other',
          device           TEXT NOT NULL DEFAULT 'other',
          os               TEXT,
          windows_json     TEXT NOT NULL DEFAULT '[]',
          tab_count        INTEGER NOT NULL DEFAULT 0,
          hidden_tab_count INTEGER NOT NULL DEFAULT 0,
          captured_at      TEXT NOT NULL,
          last_seen_at     TEXT NOT NULL,
          push_day         TEXT NOT NULL DEFAULT '',
          push_count       INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT NOT NULL
        )
      `,
      "CREATE INDEX IF NOT EXISTS idx_live_devices_last_seen ON live_devices(last_seen_at)",
      `
        CREATE TABLE IF NOT EXISTS live_settings (
          user_id    TEXT PRIMARY KEY,
          enabled    INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        )
      `,
    ],
  },
  // Per-user override for the live server base URL (user_settings created in v2).
  // Additive-only ADD COLUMN, nullable. Not exported (user_settings isn't part of
  // the export bundle), so SCHEMA_VERSION stays 1.
  {
    version: 4,
    name: "user-settings-live-server-url",
    statements: ["ALTER TABLE user_settings ADD COLUMN live_server_url TEXT"],
  },
  // Per-account "seen the first-run tour" marker (user_settings created in v2).
  // Timestamp set once the user finishes/dismisses onboarding, so the tour opens
  // once per ACCOUNT (on any device) instead of once per browser. Additive-only
  // ADD COLUMN, nullable. Not exported (user_settings isn't part of the export
  // bundle), so SCHEMA_VERSION stays 1.
  {
    version: 5,
    name: "user-settings-onboarded-at",
    statements: ["ALTER TABLE user_settings ADD COLUMN onboarded_at TEXT"],
  },
  // Persisted AI chat (conversations + full UIMessage parts) and the free-tier AI
  // token meter. chat_conversations/chat_messages ARE user data and DO round-trip
  // through the export bundle, so SCHEMA_VERSION is bumped to 2 with a v1→v2
  // upgrader (see packages/types/src/export.ts). ai_usage is a derived,
  // per-calendar-week token counter (Monday 00:00 UTC key) — NOT exported (it is
  // regenerable metering state, like a rate-limit window, not user content). All
  // bare strings, NOT tolerant: every statement is genuinely idempotent.
  {
    version: 6,
    name: "chat-persistence-and-ai-usage",
    statements: [
      `
        CREATE TABLE IF NOT EXISTS chat_conversations (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS chat_messages (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role            TEXT NOT NULL,
          parts_json      TEXT NOT NULL,
          created_at      TEXT NOT NULL
        )
      `,
      "CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id)",
      `
        CREATE TABLE IF NOT EXISTS ai_usage (
          week_start TEXT PRIMARY KEY,
          tokens     INTEGER NOT NULL DEFAULT 0
        )
      `,
    ],
  },
  // Free-form OS string captured at save time ("macOS", "Windows", "iOS", …),
  // rendered as an identifier badge on saved-session rows. Additive-only ADD
  // COLUMN, nullable — old rows read back null and the render layer omits the
  // badge. sessions ARE exported user data, so SCHEMA_VERSION bumps to 3 with a
  // v2→v3 upgrader (see packages/types/src/export.ts).
  {
    version: 7,
    name: "sessions-os",
    statements: ["ALTER TABLE sessions ADD COLUMN os TEXT"],
  },
  // Native browser-sync toggles (user_settings created in v2): extension mirrors
  // native bookmarks (+ Chrome reading list) into the library. enabled=1 default
  // (add-only sync), full=0 default (deleting a native bookmark does NOT delete
  // the saved copy unless the user opts into full sync). Additive-only ADD
  // COLUMN with constant DEFAULTs — existing rows backfill from the defaults.
  // Marked tolerant so a retry after a partial apply (duplicate column) records
  // the version instead of wedging the runner. Not exported (user_settings
  // isn't part of the export bundle), so SCHEMA_VERSION stays 3.
  {
    version: 8,
    name: "user-settings-native-sync",
    statements: [
      {
        sql: "ALTER TABLE user_settings ADD COLUMN native_sync_enabled INTEGER NOT NULL DEFAULT 1",
        tolerant: true,
      },
      {
        sql: "ALTER TABLE user_settings ADD COLUMN native_sync_full INTEGER NOT NULL DEFAULT 0",
        tolerant: true,
      },
    ],
  },
];
