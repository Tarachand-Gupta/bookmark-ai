import type { Db } from "../client";

/**
 * MCP server persistence: the token registry and the tiered rate-limit counters
 * (both tables shipped as tenant migration v10; `mcp_tokens.hint` as v11).
 *
 * `mcp_tokens` deliberately stores NO token material. A `bkmcp_` token is a
 * self-contained HS256 JWT (see apps/web/lib/server/mcp-token.ts) whose `jti` is
 * this table's primary key — the row exists so a token can be listed, given a
 * last-used timestamp, and REVOKED (a signature-valid token whose row is missing
 * or has `revoked_at` set is rejected). A revoked row is kept, never deleted, so
 * the Settings UI can still show its history.
 *
 * The one exception to "no token material" is `hint`: `bkmcp_xxxxx…xxxxx`, the
 * first and last 5 characters of the token body, computed at mint time (see
 * `mcpTokenHint`) purely so the user can tell WHICH token a row is. It is not a
 * credential and cannot be extended into one; it is NULL for rows created before
 * v11, which can never be backfilled because the value is gone.
 */
export interface McpTokenRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** `bkmcp_xxxxx…xxxxx` display hint, or null for pre-v11 rows. */
  hint: string | null;
}

function rowToToken(row: Record<string, unknown>): McpTokenRow {
  const str = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    lastUsedAt: str(row.last_used_at),
    revokedAt: str(row.revoked_at),
    // Every read below is `SELECT *`, so the v11 column arrives here with no
    // query change — and reads back undefined→null on a DB where the ALTER has
    // not run yet (a tolerant statement that was skipped), never throwing.
    hint: str(row.hint),
  };
}

/** Register a freshly minted token's `jti` plus its display `hint`. `name` is
 * user-supplied — bound. `hint` is optional so a caller that has no hint (or a
 * DB predating v11) still inserts cleanly, leaving the column NULL. */
export async function insertMcpToken(
  db: Db,
  token: { id: string; name: string; createdAt: string; hint?: string | null },
): Promise<McpTokenRow> {
  await db.execute({
    sql: "INSERT INTO mcp_tokens (id, name, created_at, hint) VALUES (?, ?, ?, ?)",
    args: [token.id, token.name, token.createdAt, token.hint ?? null],
  });
  const saved = await getMcpToken(db, token.id);
  if (!saved) throw new Error("insertMcpToken: row not found after insert");
  return saved;
}

export async function getMcpToken(db: Db, id: string): Promise<McpTokenRow | null> {
  const rs = await db.execute({ sql: "SELECT * FROM mcp_tokens WHERE id = ?", args: [id] });
  const row = rs.rows[0];
  return row ? rowToToken(row as unknown as Record<string, unknown>) : null;
}

/** All tokens (including revoked ones — kept for history), newest first. */
export async function listMcpTokens(db: Db): Promise<McpTokenRow[]> {
  const rs = await db.execute("SELECT * FROM mcp_tokens ORDER BY created_at DESC");
  return rs.rows.map((r) => rowToToken(r as unknown as Record<string, unknown>));
}

/**
 * Revoke a token by stamping `revoked_at` (the row survives so the UI can show
 * it). Returns false when the id is unknown or was already revoked — either way
 * the caller's desired end state holds, so routes may treat both as success.
 */
export async function revokeMcpToken(db: Db, id: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    args: [new Date().toISOString(), id],
  });
  return rs.rowsAffected > 0;
}

/**
 * Stamp `last_used_at`, but only when the stored value is older than
 * `staleBeforeIso`. Every MCP call would otherwise cost a write purely for
 * cosmetics; the guard is inside the atomic UPDATE (string compare works because
 * both sides are ISO-8601 UTC), so concurrent calls collapse to one write.
 */
export async function touchMcpToken(
  db: Db,
  id: string,
  staleBeforeIso: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE mcp_tokens SET last_used_at = ?
          WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
    args: [new Date().toISOString(), id, staleBeforeIso],
  });
}

// ── Tiered rate-limit counters ──

/** ~1-in-N calls also sweep expired buckets, so the table can't grow forever
 * without a cron. 100 = ~1%. */
const SWEEP_ODDS = 100;

/**
 * Atomically bump one rate-limit window's counter, capped at `max`. Modeled on
 * master.ts `bumpUsage`: ensure the row exists, then a single guarded
 * `UPDATE … WHERE count < ? RETURNING` so concurrent bumps cannot overshoot the
 * cap (libSQL serializes writes per DB and the guard lives inside the atomic
 * statement). `bucket` and `expiresAt` are always bound parameters.
 *
 * Returns whether the bump was allowed plus the resulting count.
 */
export async function bumpMcpUsage(
  db: Db,
  bucket: string,
  expiresAt: string,
  max: number,
): Promise<{ allowed: boolean; count: number }> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO mcp_usage (bucket, count, expires_at) VALUES (?, 0, ?)",
    args: [bucket, expiresAt],
  });
  const bumped = await db.execute({
    sql: `UPDATE mcp_usage SET count = count + 1
          WHERE bucket = ? AND count < ?
          RETURNING count`,
    args: [bucket, max],
  });

  if (Math.floor(Math.random() * SWEEP_ODDS) === 0) {
    // Opportunistic GC — a failure here must never fail the caller's request.
    await db
      .execute({
        sql: "DELETE FROM mcp_usage WHERE expires_at < ?",
        args: [new Date().toISOString()],
      })
      .catch(() => undefined);
  }

  const row = bumped.rows[0];
  if (row) return { allowed: true, count: Number(row.count) };

  // At (or over) the cap: nothing updated. Read the current count back.
  const current = await db.execute({
    sql: "SELECT count FROM mcp_usage WHERE bucket = ?",
    args: [bucket],
  });
  return { allowed: false, count: Number(current.rows[0]?.count ?? max) };
}
