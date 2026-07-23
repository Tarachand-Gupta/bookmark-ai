import { getPlatformConfig, setPlatformConfig } from "@bookmark-ai/db";
import { DEFAULT_FREE_AI_WEEKLY_TOKEN_LIMIT } from "@bookmark-ai/engine";
import { getMasterContext } from "@/lib/server/context";

/**
 * The global, admin-adjustable free-tier weekly AI token limit.
 *
 * Stored in the MASTER control-plane DB (`platform_config`) so a single value
 * governs the whole fleet, read here with a short (~60s) in-process cache.
 * Changing it applies within a cache TTL — enforcement compares live weekly
 * usage against this, so a user at 700k tokens facing a new 500k limit is
 * blocked. When no master DB is configured (single-shared-DB / local mode) or
 * no override is stored, the compiled DEFAULT (1,000,000) applies.
 */

const CONFIG_KEY = "free_ai_weekly_token_limit";
const CACHE_TTL_MS = 60_000;

// Process-global so it survives dev HMR and is shared across route modules in a
// warm serverless instance.
const store = globalThis as unknown as {
  __bookmarkAiLimitCache?: { value: number; at: number };
};

/**
 * Resolve the current free-tier weekly token limit (cached ~60s). Falls back to
 * the default when the master DB is absent/unreadable — never throws.
 */
export async function getFreeAiWeeklyLimit(): Promise<number> {
  const now = Date.now();
  const cached = store.__bookmarkAiLimitCache;
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  let value = DEFAULT_FREE_AI_WEEKLY_TOKEN_LIMIT;
  const master = getMasterContext();
  if (master) {
    try {
      await master.ready;
      const raw = await getPlatformConfig(master.db, CONFIG_KEY);
      const n = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) value = Math.floor(n);
    } catch (err) {
      console.warn("[ai-limit] read failed, using default/cached:", (err as Error).message);
      // Prefer a slightly stale cached value over resetting to default on a blip.
      if (cached) return cached.value;
    }
  }
  store.__bookmarkAiLimitCache = { value, at: now };
  return value;
}

/**
 * Persist a new global limit to the master DB and refresh the cache so the
 * change is effective immediately for this instance (others pick it up within
 * the TTL). Throws when no master DB is configured — admin-adjusting the limit
 * is a control-plane operation and requires MASTER_DATABASE_URL.
 */
export async function setFreeAiWeeklyLimit(limitTokens: number): Promise<number> {
  const master = getMasterContext();
  if (!master) {
    throw new Error("MASTER_DATABASE_URL is not configured — cannot persist the AI limit");
  }
  await master.ready;
  const value = Math.floor(limitTokens);
  await setPlatformConfig(master.db, CONFIG_KEY, String(value));
  store.__bookmarkAiLimitCache = { value, at: Date.now() };
  return value;
}
