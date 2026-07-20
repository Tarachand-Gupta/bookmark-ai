import {
  createDb,
  ensureMasterSchema,
  ensureSchema,
  getTenant,
  LocalFilePlatform,
  TursoPlatform,
  type Db,
  type Tenant,
} from "@bookmark-ai/db";
import { GeminiClient, provisionTenant, type TenantPlatform } from "@bookmark-ai/engine";

/**
 * Server-side context resolution for the API routes.
 *
 * Two worlds, selected by the `MULTI_TENANT` env var:
 *  - `MULTI_TENANT=1` → per-user tenant routing: each Clerk user gets their own
 *    Turso DB, looked up through the master/control-plane DB.
 *  - anything else (the default this ships with) → EXACTLY today's behavior: one
 *    shared DB from `DATABASE_URL`. Flag-off must stay byte-for-byte the old path.
 *
 * All env reads live here (and in api-context.ts) — the `packages/*` never touch
 * process.env; the adapter passes credentials in.
 */

/** True when per-user tenant routing is enabled. */
export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === "1";
}

// ── Shared single-DB context (flag-off; also the open-mode path when flag-on) ──

export interface ApiContext {
  db: Db;
  gemini: GeminiClient | null;
  /** Resolves once the schema has been ensured (runs once per process). */
  ready: Promise<void>;
}

// One context per process: survives dev HMR and is shared across route
// modules within a warm serverless instance.
const store = globalThis as unknown as {
  __bookmarkApiContext?: ApiContext;
  __bookmarkGemini?: { client: GeminiClient | null };
  __bookmarkMasterContext?: MasterContext | null;
  __bookmarkPlatform?: TenantPlatform | null;
  __bookmarkTenantDbs?: Map<string, TenantDb>;
};

/**
 * The Gemini client is process-global and tenant-independent (one API key powers
 * every tenant's categorization/embedding). Cached separately so tenant paths
 * don't have to build the shared single-DB context just to reach it.
 */
export function getGemini(): GeminiClient | null {
  if (!store.__bookmarkGemini) {
    store.__bookmarkGemini = {
      client: process.env.GEMINI_API_KEY ? new GeminiClient(process.env.GEMINI_API_KEY) : null,
    };
  }
  return store.__bookmarkGemini.client;
}

export function getApiContext(): ApiContext {
  if (!store.__bookmarkApiContext) {
    const db = createDb(
      // Fallback points at the repo-root local file DB for fully-local setups
      // (cwd is apps/web under `next dev`); deployed instances always set
      // DATABASE_URL.
      process.env.DATABASE_URL ?? "file:../../data/bookmarks.db",
      process.env.DATABASE_AUTH_TOKEN,
    );
    store.__bookmarkApiContext = {
      db,
      gemini: getGemini(),
      // A transient schema-check failure must not brick every request in
      // this instance — log it and let the first real query fail loudly.
      ready: ensureSchema(db).catch((err: unknown) => {
        console.error("[api] ensureSchema failed:", err);
      }),
    };
  }
  return store.__bookmarkApiContext;
}

// ── Master / control-plane context (flag-on, and webhook provisioning) ──

export interface MasterContext {
  db: Db;
  /** Resolves once the master schema has been ensured (once per process). */
  ready: Promise<void>;
}

/**
 * The master DB holds the tenant directory + per-day usage counters. Cached
 * (including a cached `null` when the env is absent) — required whenever the
 * flag is on or webhook provisioning runs, otherwise null.
 */
export function getMasterContext(): MasterContext | null {
  if (store.__bookmarkMasterContext === undefined) {
    const url = process.env.MASTER_DATABASE_URL;
    if (!url) {
      store.__bookmarkMasterContext = null;
    } else {
      const db = createDb(url, process.env.MASTER_DATABASE_AUTH_TOKEN);
      store.__bookmarkMasterContext = {
        db,
        ready: ensureMasterSchema(db)
          .then(() => undefined)
          .catch((err: unknown) => {
            console.error("[api] ensureMasterSchema failed:", err);
          }),
      };
    }
  }
  return store.__bookmarkMasterContext;
}

/**
 * The tenant provisioning platform: local sqlite files in dev
 * (`TENANT_PLATFORM=local`, non-production only — mirrors the `DEV_OPEN_API`
 * guard in require-user.ts), else the Turso Platform client, or null if its
 * env (`TURSO_API_TOKEN` + `TURSO_ORG`) is not configured. `TURSO_GROUP`
 * defaults to "default".
 */
export function getPlatform(): TenantPlatform | null {
  if (store.__bookmarkPlatform === undefined) {
    if (process.env.TENANT_PLATFORM === "local" && process.env.NODE_ENV !== "production") {
      store.__bookmarkPlatform = new LocalFilePlatform(process.env.TENANT_DB_DIR ?? "../../data/tenants");
    } else {
      const apiToken = process.env.TURSO_API_TOKEN;
      const org = process.env.TURSO_ORG;
      if (!apiToken || !org) {
        store.__bookmarkPlatform = null;
      } else {
        store.__bookmarkPlatform = new TursoPlatform({
          apiToken,
          org,
          group: process.env.TURSO_GROUP || "default",
        });
      }
    }
  }
  return store.__bookmarkPlatform;
}

// ── Per-tenant DB routing (flag-on) ──

export interface TenantDb {
  db: Db;
  /** Resolves once ensureSchema has run for this cached client (once per open). */
  ready: Promise<void>;
}

// Bounded LRU-ish cache of open tenant clients, keyed by Clerk user id. Map
// preserves insertion order, so the first keys are the oldest — evict those.
const TENANT_CACHE_MAX = 100;
function tenantCache(): Map<string, TenantDb> {
  if (!store.__bookmarkTenantDbs) store.__bookmarkTenantDbs = new Map();
  return store.__bookmarkTenantDbs;
}

/**
 * Open (and cache) a client for a tenant record, running ensureSchema once per
 * cached client — cheap, it's the versioned migration runner and a no-op once a
 * tenant is at the latest version. Exposed so the cron fan-out can reuse the
 * same caching without re-reading the tenant row it already has.
 */
export function tenantDbFromRecord(tenant: Tenant): TenantDb {
  const cache = tenantCache();
  const hit = cache.get(tenant.clerkUserId);
  if (hit) return hit;

  // file: URLs (local/dev tenants) take no auth token — mirror createDb.
  const db = createDb(
    tenant.dbUrl,
    tenant.dbUrl.startsWith("file:") ? undefined : tenant.dbAuthToken,
  );
  const entry: TenantDb = {
    db,
    ready: ensureSchema(db).catch((err: unknown) => {
      console.error(`[api] ensureSchema failed for tenant ${tenant.clerkUserId}:`, err);
    }),
  };
  cache.set(tenant.clerkUserId, entry);
  while (cache.size > TENANT_CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry;
}

/** Flag-on: the tenant exists in the master directory but has no active DB yet
 * (webhook provisioning can lag signup by seconds). Routes map this to 503. */
export class TenantNotProvisionedError extends Error {
  constructor() {
    super("Account not provisioned yet");
    this.name = "TenantNotProvisionedError";
  }
}

/** Flag-on but the master/control-plane env is missing — a deploy
 * misconfiguration, not a per-user condition. Routes map this to 503 + log. */
export class MultiTenantConfigError extends Error {
  constructor(message = "Multi-tenant mode is misconfigured") {
    super(message);
    this.name = "MultiTenantConfigError";
  }
}

/**
 * In-flight lazy provisions, keyed by user, so the several requests a freshly
 * loaded page fires don't each try to provision the same tenant.
 */
const inflightProvision = new Map<string, Promise<Tenant>>();

/**
 * Provision a tenant from the REQUEST path, deduped per user.
 *
 * The `user.created` webhook is the normal path, but a real signup lands on
 * /app milliseconds after the redirect — far sooner than webhook delivery — so
 * the request path has to be able to provision on its own instead of 503ing.
 * The webhook stays the fast path; this is the safety net (it also covers
 * webhook failure/retry and users who predate the flag).
 */
async function provisionOnce(
  master: Db,
  platform: TenantPlatform,
  userId: string,
): Promise<Tenant> {
  const running = inflightProvision.get(userId);
  if (running) return running;

  const pending = (async () => {
    try {
      return await provisionTenant({ master, platform, clerkUserId: userId });
    } catch (err) {
      // The webhook (or another instance) may have won the race and inserted the
      // row while we were working — its tenant is authoritative, so prefer it
      // over surfacing a collision error.
      const raced = await getTenant(master, userId);
      if (raced && raced.status === "active") return raced;
      throw err;
    } finally {
      inflightProvision.delete(userId);
    }
  })();

  inflightProvision.set(userId, pending);
  return pending;
}

/**
 * Resolve the DB a signed-in user's request should read/write.
 *  - flag OFF → the shared single-DB context (identical to today).
 *  - flag ON  → look the tenant up in the master directory and open its DB,
 *    provisioning it on the spot if this user has no tenant yet.
 * Throws TenantNotProvisionedError (tenant exists but is not active, or we
 * cannot provision) or MultiTenantConfigError (flag on, master env missing).
 */
export async function getTenantDb(userId: string): Promise<TenantDb> {
  if (!isMultiTenant()) {
    const { db, ready } = getApiContext();
    return { db, ready };
  }
  const master = getMasterContext();
  if (!master) {
    throw new MultiTenantConfigError("MULTI_TENANT=1 but MASTER_DATABASE_URL is not set");
  }
  await master.ready;

  let tenant = await getTenant(master.db, userId);
  if (!tenant) {
    const platform = getPlatform();
    // No platform client → we genuinely cannot self-heal; let the route 503 and
    // wait for the webhook.
    if (!platform) throw new TenantNotProvisionedError();
    tenant = await provisionOnce(master.db, platform, userId);
  }
  if (tenant.status !== "active") throw new TenantNotProvisionedError();
  return tenantDbFromRecord(tenant);
}
