import { createHash } from "node:crypto";
import {
  createDb,
  deleteTenant,
  getTenant,
  insertTenant,
  runMigrations,
  TENANT_MIGRATIONS,
  type Db,
  type Tenant,
} from "@bookmark-ai/db";

/**
 * The subset of the Turso Platform client that provisioning needs. Kept as an
 * interface so tests can stub it — e.g. returning `file:` URLs to run entirely
 * against local libsql DBs without ever calling the real Platform API.
 */
export interface TenantPlatform {
  /** `created` is true only when this call created the DB (false on adopt/409). */
  createDatabase(name: string): Promise<{ name: string; hostname: string; created: boolean }>;
  getDatabase(name: string): Promise<{ name: string; hostname: string; created: boolean }>;
  deleteDatabase(name: string): Promise<void>;
  createToken(
    dbName: string,
    opts: { authorization: "full-access" | "read-only"; expiration?: string },
  ): Promise<string>;
}

export interface ProvisionTenantArgs {
  master: Db;
  platform: TenantPlatform;
  clerkUserId: string;
}

export interface DeprovisionTenantArgs {
  master: Db;
  platform: TenantPlatform;
  clerkUserId: string;
}

/**
 * Deterministic, Turso-name-safe DB name: `bmk-` + first 12 hex chars of
 * sha256(clerkUserId). Stable so webhook retries and deprovision compute the
 * same name without needing the tenant row.
 */
export function tenantDbName(clerkUserId: string): string {
  const hash = createHash("sha256").update(clerkUserId).digest("hex");
  return `bmk-${hash.slice(0, 12)}`;
}

// A hostname already carrying a scheme (a stub's `file:`/`libsql:` URL) is used
// as-is; a bare Turso hostname becomes a libsql:// URL.
function toDbUrl(hostname: string): string {
  if (hostname.includes("://") || hostname.startsWith("file:")) return hostname;
  return `libsql://${hostname}`;
}

/**
 * Provision a tenant's per-user DB. Idempotent (Clerk webhooks retry): an
 * existing active tenant row short-circuits and is returned unchanged.
 * Otherwise: create the DB, mint a full-access token, run the tenant migrations
 * against it, record the tenant row, and return it. If any step AFTER the DB is
 * created fails, the freshly-created DB (and its full-access token) are deleted
 * before rethrowing, so a failed provision self-cleans instead of orphaning a
 * live database + token that a webhook retry would only duplicate.
 */
export async function provisionTenant({
  master,
  platform,
  clerkUserId,
}: ProvisionTenantArgs): Promise<Tenant> {
  const existing = await getTenant(master, clerkUserId);
  if (existing && existing.status === "active") return existing;

  const dbName = tenantDbName(clerkUserId);
  const database = await platform.createDatabase(dbName);

  // A pre-existing DB with no active tenant row for THIS user must not be
  // adopted: the DB name is a 48-bit hash prefix of the clerk id, so (however
  // astronomically) it could collide with another user's DB — minting a
  // full-access token against it would hand over their data. Refuse instead.
  if (!database.created && !(existing && existing.status === "active")) {
    console.error(
      `provisionTenant: DB ${dbName} already exists but no active tenant row for ${clerkUserId}; refusing to adopt`,
    );
    throw new Error(`provisionTenant: refusing to adopt pre-existing database ${dbName}`);
  }

  try {
    const token = await platform.createToken(dbName, { authorization: "full-access" });
    const dbUrl = toDbUrl(database.hostname);

    // file: DBs (test stubs) take no auth token — mirror createDb's own handling.
    const client = createDb(dbUrl, dbUrl.startsWith("file:") ? undefined : token);
    await runMigrations(client, TENANT_MIGRATIONS);

    return await insertTenant(master, {
      clerkUserId,
      dbName,
      dbUrl,
      dbAuthToken: token,
      status: "active",
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // We created the DB this call, so clean it up (and its token) before
    // rethrowing. Tolerate delete failures — the original error is what matters.
    try {
      await platform.deleteDatabase(dbName);
    } catch (cleanupErr) {
      console.error(`provisionTenant: cleanup of ${dbName} after failure also failed:`, cleanupErr);
    }
    throw err;
  }
}

/**
 * Deprovision a tenant: delete the Turso DB (tolerating a missing one) and the
 * tenant row. Idempotent — the DB name is derived deterministically, so this
 * works even if the tenant row is already gone.
 */
export async function deprovisionTenant({
  master,
  platform,
  clerkUserId,
}: DeprovisionTenantArgs): Promise<void> {
  const existing = await getTenant(master, clerkUserId);
  const dbName = existing?.dbName ?? tenantDbName(clerkUserId);
  await platform.deleteDatabase(dbName);
  await deleteTenant(master, clerkUserId);
}
