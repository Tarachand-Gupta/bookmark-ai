import type { Row } from "@libsql/client";
import type { Db } from "./client";
import { runMigrations, type Migration } from "./migrations";

/** A row in the master `tenants` table: Clerk user → their per-user Turso DB. */
export interface Tenant {
  clerkUserId: string;
  dbName: string;
  dbUrl: string;
  dbAuthToken: string;
  status: string;
  createdAt: string;
}

/** Per-day usage counters a tenant is metered against. */
export type UsageField = "saves" | "sessions" | "chats" | "searches";

const USAGE_FIELDS: readonly UsageField[] = ["saves", "sessions", "chats", "searches"];

/**
 * The master/control-plane schema as versioned migrations. v1 "baseline": the
 * tenant directory + per-day usage counters. Append new migrations; never edit v1.
 */
export const MASTER_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline",
    statements: [
      `
        CREATE TABLE IF NOT EXISTS tenants (
          clerk_user_id TEXT PRIMARY KEY,
          db_name       TEXT UNIQUE NOT NULL,
          db_url        TEXT NOT NULL,
          db_auth_token TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'active',
          created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage (
          user_id  TEXT NOT NULL,
          day      TEXT NOT NULL,
          saves    INTEGER NOT NULL DEFAULT 0,
          sessions INTEGER NOT NULL DEFAULT 0,
          chats    INTEGER NOT NULL DEFAULT 0,
          -- searches added to v1 directly: the master DB is freshly created and
          -- has NEVER been migrated, so extending the baseline DDL is safe here
          -- (no deployed DB carries a v1 without this column).
          searches INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day)
        );
      `,
    ],
  },
  // Global control-plane key/value config, read with a short in-process cache in
  // the API layer. Currently holds the admin-adjustable free-tier AI weekly token
  // limit ("free_ai_weekly_token_limit"). Append-only additive migration; never
  // edit v1. Not user data → no export-format impact.
  {
    version: 2,
    name: "platform-config",
    statements: [
      `
        CREATE TABLE IF NOT EXISTS platform_config (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `,
    ],
  },
];

/** Read a single platform_config value by key, or null if unset. */
export async function getPlatformConfig(db: Db, key: string): Promise<string | null> {
  const rs = await db.execute({
    sql: "SELECT value FROM platform_config WHERE key = ?",
    args: [key],
  });
  const row = rs.rows[0];
  return row ? String(row.value) : null;
}

/** Upsert a single platform_config value. `updated_at` is refreshed to now. */
export async function setPlatformConfig(db: Db, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO platform_config (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, new Date().toISOString()],
  });
}

/** Idempotent master schema setup. Mirrors ensureSchema for the control plane. */
export async function ensureMasterSchema(db: Db): Promise<number> {
  return runMigrations(db, MASTER_MIGRATIONS);
}

function rowToTenant(row: Row): Tenant {
  return {
    clerkUserId: String(row.clerk_user_id),
    dbName: String(row.db_name),
    dbUrl: String(row.db_url),
    dbAuthToken: String(row.db_auth_token),
    status: String(row.status),
    createdAt: String(row.created_at),
  };
}

/** Look up a tenant by Clerk user id (any status), or null if none. */
export async function getTenant(db: Db, clerkUserId: string): Promise<Tenant | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM tenants WHERE clerk_user_id = ?",
    args: [clerkUserId],
  });
  const row = rs.rows[0];
  return row ? rowToTenant(row) : null;
}

/** Insert a tenant row and return it. Throws if the id/db_name already exists. */
export async function insertTenant(db: Db, t: Tenant): Promise<Tenant> {
  await db.execute({
    sql: `INSERT INTO tenants (clerk_user_id, db_name, db_url, db_auth_token, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [t.clerkUserId, t.dbName, t.dbUrl, t.dbAuthToken, t.status, t.createdAt],
  });
  const saved = await getTenant(db, t.clerkUserId);
  if (!saved) throw new Error("insertTenant: row not found after insert");
  return saved;
}

/** Remove a tenant row. Returns whether a row was deleted. */
export async function deleteTenant(db: Db, clerkUserId: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "DELETE FROM tenants WHERE clerk_user_id = ?",
    args: [clerkUserId],
  });
  return rs.rowsAffected > 0;
}

/** All active tenants — the fan-out list for cross-tenant sweeps (e.g. embed). */
export async function listActiveTenants(db: Db): Promise<Tenant[]> {
  const rs = await db.execute({
    sql: "SELECT * FROM tenants WHERE status = ? ORDER BY created_at ASC",
    args: ["active"],
  });
  return rs.rows.map(rowToTenant);
}

/**
 * Atomically bump one per-day usage counter, capped at `max`. Ensures the row
 * exists, then does a single guarded `UPDATE … WHERE <field> < ? RETURNING` so
 * concurrent bumps can't overshoot the cap (Turso serializes writes per DB, and
 * the guard is inside the atomic statement). Returns whether the bump was
 * allowed and the resulting count. `field` is validated against the literal
 * union before it is interpolated — never a raw string in SQL.
 */
export async function bumpUsage(
  db: Db,
  userId: string,
  day: string,
  field: UsageField,
  max: number,
): Promise<{ allowed: boolean; count: number }> {
  if (!USAGE_FIELDS.includes(field)) {
    throw new Error(`bumpUsage: invalid field "${field}"`);
  }
  await db.execute({
    sql: "INSERT OR IGNORE INTO usage (user_id, day) VALUES (?, ?)",
    args: [userId, day],
  });
  const bumped = await db.execute({
    sql: `UPDATE usage SET ${field} = ${field} + 1
          WHERE user_id = ? AND day = ? AND ${field} < ?
          RETURNING ${field} AS count`,
    args: [userId, day, max],
  });
  const row = bumped.rows[0];
  if (row) return { allowed: true, count: Number(row.count) };

  // At (or over) the cap: nothing updated. Read back the current count.
  const current = await db.execute({
    sql: `SELECT ${field} AS count FROM usage WHERE user_id = ? AND day = ?`,
    args: [userId, day],
  });
  return { allowed: false, count: Number(current.rows[0]?.count ?? max) };
}
