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
  // MCP server surface: `mcp_tokens` is the revocation/last-used registry for the
  // long-lived `bkmcp_` bearer tokens (the token VALUE is never stored — it's a
  // self-contained HS256 JWT and the row is keyed by its `jti`), `mcp_usage` is the
  // per-user tiered rate-limit counter keyed by "<window kind>:<window start>".
  // Neither is exported: credentials + regenerable metering state, like ai_usage —
  // so SCHEMA_VERSION stays 3. mcp_tools_json is the per-user enabled-tool
  // allowlist (NULL = all tools enabled); tolerant so a retry after a partial
  // apply (duplicate column) records the version instead of wedging the runner.
  //
  // v10, NOT v9: prod's schema_migrations already records `9:newtab-canvas` from
  // the REVERTED newtab feature (the revert removed the code; recorded versions
  // and dormant tables stay, per the additive-only rule) — shipping this as v9
  // made the runner silently skip it in production ("no such table: mcp_tokens",
  // 2026-08-10). A revert NEVER frees a version number: always take the next
  // number after the highest EVER recorded in prod, not the highest in this file.
  // Statements are idempotent, so dev DBs that applied the short-lived "9:mcp"
  // re-apply v10 as a no-op.
  {
    version: 10,
    name: "mcp",
    statements: [
      `
        CREATE TABLE IF NOT EXISTS mcp_tokens (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          last_used_at TEXT,
          revoked_at   TEXT
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS mcp_usage (
          bucket     TEXT PRIMARY KEY,
          count      INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT NOT NULL
        )
      `,
      { sql: "ALTER TABLE user_settings ADD COLUMN mcp_tools_json TEXT", tolerant: true },
    ],
  },
  // Non-reversible identity hint for an MCP token row: `bkmcp_xxxxx…xxxxx` (first
  // and last 5 chars of the token body), computed at MINT time because the token
  // VALUE is never stored — without it a Settings list of three tokens gives the
  // user no way to tell which row matches the credential in a given client's
  // config. Additive-only ADD COLUMN, nullable: tokens minted before this
  // migration read back NULL and the UI renders nothing for them (no backfill is
  // possible — the value is gone). Tolerant so a retry after a partial apply
  // ("duplicate column name: hint") records the version instead of wedging the
  // runner and every later migration behind a permanently-pending version.
  // mcp_tokens is NOT part of the export bundle (credential metadata, like
  // ai_usage — see the v10 comment), so SCHEMA_VERSION in
  // packages/types/src/export.ts stays at 3; nothing to migrate in exported bundles.
  //
  // v11 for the same reason v10 wasn't v9: version numbers are burned FOREVER,
  // never reclaimed. The highest number ever recorded in prod is 10, so this is
  // 11 — a migration numbered at or below a version prod already has in
  // `schema_migrations` is silently skipped there (that is exactly how the first
  // `mcp` migration shipped as v9 and produced "no such table: mcp_tokens" in
  // production while working locally).
  {
    version: 11,
    name: "mcp-token-hint",
    statements: [{ sql: "ALTER TABLE mcp_tokens ADD COLUMN hint TEXT", tolerant: true }],
  },
  // AI summary for a saved session: `description` holds 1-2 sentences on what
  // that window of tabs was about, generated post-save (Next `after()` in
  // POST /api/sessions) and refreshed by the Summarize affordance. Additive,
  // nullable ADD COLUMN — sessions saved before this read back NULL and the UI
  // simply renders no summary block until one is generated. Tolerant so a retry
  // after a partial apply ("duplicate column name: description") records the
  // version instead of wedging the runner and every later migration behind a
  // permanently-pending version.
  //
  // `sessions` IS part of the export bundle (unlike mcp_tokens/ai_usage), so per
  // the migrations rule this ALSO bumps SCHEMA_VERSION 3→4 in
  // packages/types/src/export.ts with a v3→v4 `migrateExportBundle` upgrader.
  //
  // v12 because the highest version EVER recorded in prod is 11: numbers are
  // burned forever and a migration numbered at or below one prod already has in
  // `schema_migrations` is SILENTLY SKIPPED there (how the first `mcp` migration
  // shipped as v9 and produced "no such table: mcp_tokens" in production).
  {
    version: 12,
    name: "session-description",
    statements: [{ sql: "ALTER TABLE sessions ADD COLUMN description TEXT", tolerant: true }],
  },
  // Semantic search over SAVED SESSIONS: the same F32_BLOB(768) vector the
  // bookmarks table has carried since v1, so "the research on rust async
  // runtimes" finds a session whose name is "Aug 11, 1:22 am · 37 tabs" and
  // whose subject only exists in its AI description and tab titles.
  //
  // Additive, nullable ADD COLUMN + the same `tolerant` ANN index as
  // idx_bookmarks_embedding (libSQL builds without vector support degrade to an
  // unindexed scan instead of wedging this and every later migration). Every
  // existing session reads back NULL, which is exactly the "needs embedding"
  // state `listUnembeddedSessions` sweeps — no backfill step, the embed sweep IS
  // the backfill. Both statements tolerant so a retry after a partial apply
  // ("duplicate column name: embedding") records the version instead of leaving
  // it permanently pending.
  //
  // NOT exported and NO SCHEMA_VERSION bump: an embedding is regenerable derived
  // data, so it is excluded from the export bundle for the same reason
  // bookmarks.embedding is (see packages/types/src/export.ts) — an imported
  // session simply comes back with a NULL vector and the sweep refills it.
  //
  // v13 because 12 is the highest version ever recorded in prod: numbers are
  // burned forever, and a migration numbered at or below one prod already has in
  // `schema_migrations` is SILENTLY SKIPPED there.
  {
    version: 13,
    name: "session-embedding",
    statements: [
      { sql: `ALTER TABLE sessions ADD COLUMN embedding F32_BLOB(${EMBEDDING_DIM})`, tolerant: true },
      {
        sql: "CREATE INDEX IF NOT EXISTS idx_sessions_embedding ON sessions(libsql_vector_idx(embedding))",
        tolerant: true,
      },
    ],
  },
  // Two additive changes shipped together (2026-09-03):
  //
  // `skills` — the user's reusable Ask AI instruction bundles (name, one-line
  // description the agent matches against, the instructions, an enabled flag).
  // Name uniqueness is enforced case-insensitively in the engine (409); the
  // plain UNIQUE index is the DB-level backstop. Skills ARE user data and DO
  // round-trip through the export bundle, so SCHEMA_VERSION bumps 4→5 with a
  // v4→v5 upgrader (see packages/types/src/export.ts).
  //
  // `user_settings.ai_mode` — the EXPLICIT "included free AI" vs "your own key"
  // choice. Until now the mode was derived from whether a key was stored, which
  // made "switch to free AI" delete the key; NULL keeps that legacy derivation
  // (key stored → 'own', else 'included') so no backfill is needed. Tolerant so
  // a retry after a partial apply ("duplicate column name: ai_mode") records the
  // version instead of wedging the runner. user_settings is not exported.
  //
  // v14 because 13 is the highest version ever recorded in prod (verified
  // against schema_migrations on 2026-09-03): numbers are burned forever, and a
  // migration numbered at or below one prod already has is SILENTLY SKIPPED.
  {
    version: 14,
    name: "skills-and-ai-mode",
    statements: [
      `
        CREATE TABLE IF NOT EXISTS skills (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          description  TEXT NOT NULL,
          instructions TEXT NOT NULL,
          enabled      INTEGER NOT NULL DEFAULT 1,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        )
      `,
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_name ON skills(name)",
      { sql: "ALTER TABLE user_settings ADD COLUMN ai_mode TEXT", tolerant: true },
    ],
  },
];
