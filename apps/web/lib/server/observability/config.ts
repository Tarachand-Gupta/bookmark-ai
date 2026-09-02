import { getPlatformConfig, setPlatformConfig } from "@bookmark-ai/db";
import type { TraceSurface } from "@bookmark-ai/engine";
import type { ObservabilitySurfaces } from "@bookmark-ai/types";
import { getMasterContext } from "@/lib/server/context";

/**
 * The global, admin-adjustable observability (Langfuse tracing) switches — one
 * boolean per AI surface. Same storage/caching pattern as ai-limit.ts: the
 * MASTER control-plane DB's `platform_config` holds one JSON value governing
 * the fleet, read here with a ~60s in-process cache; when no master DB is
 * configured (single-shared-DB / local mode) or nothing is stored, the
 * compiled defaults (ALL ON) apply. Reads never throw.
 *
 * Whether tracing can happen AT ALL is a separate, env-level question:
 * `isObservabilityConfigured()` — no Langfuse keys, no tracing, whatever the
 * flags say.
 */

const CONFIG_KEY = "observability_config";
const CACHE_TTL_MS = 60_000;

const DEFAULTS: ObservabilitySurfaces = {
  askAi: true,
  sessionSummary: true,
  categorize: true,
  embed: true,
  search: true,
};

// Process-global so it survives dev HMR and is shared across route modules in a
// warm serverless instance (same idiom as ai-limit.ts).
const store = globalThis as unknown as {
  __bookmarkObservabilityCache?: { value: ObservabilitySurfaces; at: number };
};

/** True when the server can export traces (both Langfuse keys present). */
export function isObservabilityConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/**
 * Parse a stored config value over the defaults. Unknown keys are dropped,
 * non-boolean values ignored — a corrupt row degrades to defaults, key by key.
 * Pure and exported for tests.
 */
export function withObservabilityDefaults(raw: string | null): ObservabilitySurfaces {
  const merged = { ...DEFAULTS };
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of Object.keys(DEFAULTS) as (keyof ObservabilitySurfaces)[]) {
        if (typeof parsed?.[key] === "boolean") merged[key] = parsed[key] as boolean;
      }
    } catch {
      // Corrupt JSON → defaults.
    }
  }
  return merged;
}

/** Resolve the current per-surface flags (cached ~60s). Never throws. */
export async function getObservabilityConfig(): Promise<ObservabilitySurfaces> {
  const now = Date.now();
  const cached = store.__bookmarkObservabilityCache;
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  let value = { ...DEFAULTS };
  const master = getMasterContext();
  if (master) {
    try {
      await master.ready;
      value = withObservabilityDefaults(await getPlatformConfig(master.db, CONFIG_KEY));
    } catch (err) {
      console.warn("[observability] config read failed, using default/cached:", (err as Error).message);
      // Prefer a slightly stale cached value over resetting to defaults on a blip.
      if (cached) return cached.value;
    }
  }
  store.__bookmarkObservabilityCache = { value, at: now };
  return value;
}

/**
 * Merge + persist new surface flags to the master DB and refresh the cache so
 * the change is effective immediately for this instance (others pick it up
 * within the TTL). Throws when no master DB is configured — adjusting the
 * flags is a control-plane operation (mirrors setFreeAiWeeklyLimit).
 */
export async function setObservabilityConfig(
  partial: Partial<ObservabilitySurfaces>,
): Promise<ObservabilitySurfaces> {
  const master = getMasterContext();
  if (!master) {
    throw new Error("MASTER_DATABASE_URL is not configured — cannot persist observability config");
  }
  await master.ready;
  const value = { ...(await getObservabilityConfig()), ...partial };
  await setPlatformConfig(master.db, CONFIG_KEY, JSON.stringify(value));
  store.__bookmarkObservabilityCache = { value, at: Date.now() };
  return value;
}

/** engine `TraceSurface` → config flag. */
const SURFACE_FLAG: Record<TraceSurface, keyof ObservabilitySurfaces> = {
  "ask-ai": "askAi",
  "session-summary": "sessionSummary",
  categorize: "categorize",
  embed: "embed",
  search: "search",
};

/**
 * The tracing gate handed to the engine (`setTracingGate`) and consulted by
 * the chat route: keys present AND the surface's flag on. Never throws.
 */
export async function isSurfaceEnabled(surface: TraceSurface): Promise<boolean> {
  if (!isObservabilityConfigured()) return false;
  const config = await getObservabilityConfig();
  return config[SURFACE_FLAG[surface]];
}
