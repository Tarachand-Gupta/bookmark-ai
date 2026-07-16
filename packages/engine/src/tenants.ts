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
 * Provision a tenant's per-user DB. Idempotent and safe to run concurrently —
 * the Clerk webhook and the request path (lazy provisioning) race on every real
 * signup, and webhooks retry on top of that. An existing active tenant row
 * short-circuits and is returned unchanged. Otherwise: create (or adopt) the DB,
 * mint a full-access token, run the tenant migrations, record the tenant row,
 * and return it. If a concurrent provisioner records the row first, its tenant
 * wins. A database this call actually created is deleted on failure so a failed
 * provision self-cleans; an ADOPTED database is never deleted (it may belong to
 * a live tenant).
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

  // `created: false` means the DB already existed. Its name is a deterministic
  // hash of THIS user's clerk id, so it is almost certainly their own — the
  // webhook racing this request-path provision, or an earlier partial attempt.
  // Adopt it. Refusing would wedge the account forever (the DB never goes away,
  // so every retry would refuse again). The theoretical risk is a 48-bit hash
  // collision with a DIFFERENT user; the master row's UNIQUE db_name constraint
  // is what actually stops a cross-user mapping from being recorded, and the
  // insert below is where that would surface.

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
    // A concurrent provisioner (the webhook vs. this request path) may have
    // recorded the row first — e.g. our insert lost on the primary key. Its
    // tenant is authoritative, so prefer it over surfacing the collision.
    const raced = await getTenant(master, clerkUserId);
    if (raced && raced.status === "active") return raced;

    // Only clean up a database THIS call created. Never delete one we adopted —
    // it may be a live tenant's DB that another provisioner is mid-way through.
    if (database.created) {
      try {
        await platform.deleteDatabase(dbName);
      } catch (cleanupErr) {
        console.error(`provisionTenant: cleanup of ${dbName} after failure also failed:`, cleanupErr);
      }
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
