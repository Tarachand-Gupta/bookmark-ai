import type { Db } from "../client";

/**
 * A row of the per-user `user_settings` table (AI provider config). Every AI
 * column is nullable — a fresh user has no row at all until they first save.
 * `aiApiKey` is the raw stored key; the API layer masks it before responding.
 */
export interface UserSettingsRow {
  userId: string;
  aiProvider: string | null;
  aiBaseUrl: string | null;
  aiApiKey: string | null;
  aiModel: string | null;
  /** Per-user override for the live server base URL; null = use the env default. */
  liveServerUrl: string | null;
  /** When the user finished/dismissed the first-run tour; null = not yet seen. */
  onboardedAt: string | null;
  /** Native browser-sync toggles (migration v8) — stored as INTEGER 0/1. */
  nativeSyncEnabled: boolean;
  nativeSyncFull: boolean;
  /** JSON array of the MCP tool names this user has enabled (migration v9).
   * null = the column was never written → ALL tools enabled (default-on). */
  mcpToolsJson: string | null;
  updatedAt: string;
}

/**
 * Fields `upsertUserSettings` may write. A key present here (even set to `null`)
 * is written; a key that is absent is left untouched (partial update).
 */
export interface UserSettingsPatch {
  aiProvider?: string | null;
  aiBaseUrl?: string | null;
  aiApiKey?: string | null;
  aiModel?: string | null;
  liveServerUrl?: string | null;
  onboardedAt?: string | null;
  nativeSyncEnabled?: boolean;
  nativeSyncFull?: boolean;
  mcpToolsJson?: string | null;
}

/** Column name for each patch field, in a stable order. */
const PATCH_COLUMNS: [keyof UserSettingsPatch, string][] = [
  ["aiProvider", "ai_provider"],
  ["aiBaseUrl", "ai_base_url"],
  ["aiApiKey", "ai_api_key"],
  ["aiModel", "ai_model"],
  ["liveServerUrl", "live_server_url"],
  ["onboardedAt", "onboarded_at"],
  ["nativeSyncEnabled", "native_sync_enabled"],
  ["nativeSyncFull", "native_sync_full"],
  ["mcpToolsJson", "mcp_tools_json"],
];

export async function getUserSettings(db: Db, userId: string): Promise<UserSettingsRow | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM user_settings WHERE user_id = ?",
    args: [userId],
  });
  const row = rs.rows[0];
  return row ? rowToSettings(row as unknown as Record<string, unknown>) : null;
}

/**
 * Insert or update a user's settings via SQLite UPSERT. Only the fields present
 * in `patch` are written (the ON CONFLICT clause touches just those columns);
 * everything else is preserved. `updated_at` is always refreshed to now.
 */
export async function upsertUserSettings(
  db: Db,
  userId: string,
  patch: UserSettingsPatch,
): Promise<UserSettingsRow> {
  const updatedAt = new Date().toISOString();

  const cols: string[] = [];
  const values: (string | number | null)[] = [];
  const conflictSets: string[] = [];
  for (const [key, col] of PATCH_COLUMNS) {
    if (key in patch) {
      cols.push(col);
      const v = patch[key];
      // Boolean flags store as SQLite INTEGER 0/1.
      values.push(typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null));
      conflictSets.push(`${col} = excluded.${col}`);
    }
  }

  const insertCols = ["user_id", "updated_at", ...cols];
  const placeholders = insertCols.map(() => "?").join(", ");
  const sql = `
    INSERT INTO user_settings (${insertCols.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(user_id) DO UPDATE SET
      ${["updated_at = excluded.updated_at", ...conflictSets].join(", ")}
  `;
  await db.execute({ sql, args: [userId, updatedAt, ...values] });

  const saved = await getUserSettings(db, userId);
  if (!saved) throw new Error("upsertUserSettings: row not found after upsert");
  return saved;
}

function rowToSettings(row: Record<string, unknown>): UserSettingsRow {
  const str = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    userId: String(row.user_id),
    aiProvider: str(row.ai_provider),
    aiBaseUrl: str(row.ai_base_url),
    aiApiKey: str(row.ai_api_key),
    aiModel: str(row.ai_model),
    liveServerUrl: str(row.live_server_url),
    onboardedAt: str(row.onboarded_at),
    // Fallbacks match the migration defaults (sync on, full sync off) for rows
    // that predate v8 and didn't get the column backfilled.
    nativeSyncEnabled:
      row.native_sync_enabled == null ? true : Boolean(Number(row.native_sync_enabled)),
    nativeSyncFull: row.native_sync_full == null ? false : Boolean(Number(row.native_sync_full)),
    mcpToolsJson: str(row.mcp_tools_json),
    updatedAt: String(row.updated_at),
  };
}
