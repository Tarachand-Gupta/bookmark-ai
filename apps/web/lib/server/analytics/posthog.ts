import { createHash, createHmac } from "node:crypto";

const EVENTS = [
  "bookmark_save_completed",
  "session_save_completed",
  "search_completed",
  "chat_response_completed",
  "chat_response_failed",
  "import_completed",
  "export_completed",
] as const;
export type AnalyticsEvent = (typeof EVENTS)[number];
const PLATFORMS = [
  "web",
  "pwa",
  "ios",
  "android",
  "macos",
  "extension-chrome",
  "extension-firefox",
  "extension-safari",
  "desktop",
  "mcp",
  "unknown",
] as const;
export type AnalyticsPlatform = (typeof PLATFORMS)[number];
export interface AnalyticsProperties {
  item_count?: number;
  result_count?: number;
  duration_ms?: number;
  search_mode?: "text" | "ai" | "hybrid";
  ai_source?: "included" | "own";
  outcome?: "success" | "failure";
}
export interface ProductEventInput {
  event: AnalyticsEvent;
  userId: string | null;
  platform: AnalyticsPlatform;
  properties?: AnalyticsProperties;
}
export function analyticsPlatform(request: Request): AnalyticsPlatform {
  const value = request.headers.get("X-Bookmark-Client");
  if (request.headers.get("X-Bookmark-Analytics-Consent") === "denied") return "unknown";
  if (
    value === "extension-firefox" &&
    request.headers.get("X-Bookmark-Analytics-Consent") !== "granted"
  )
    return "unknown";
  return PLATFORMS.includes(value as AnalyticsPlatform) ? (value as AnalyticsPlatform) : "unknown";
}
function cleanProperties(input: AnalyticsProperties = {}): AnalyticsProperties {
  const result: AnalyticsProperties = {};
  for (const key of ["item_count", "result_count", "duration_ms"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9)
      result[key] = Math.round(value);
  }
  if (["text", "ai", "hybrid"].includes(input.search_mode!)) result.search_mode = input.search_mode;
  if (["included", "own"].includes(input.ai_source!)) result.ai_source = input.ai_source;
  if (["success", "failure"].includes(input.outcome!)) result.outcome = input.outcome;
  return result;
}
async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("analytics timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function analyticsBudgetCycle(now: Date, startDay: number): string {
  const cycle = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCDate() < startDay ? 1 : 0), 1),
  );
  return cycle.toISOString().slice(0, 7);
}
type Reservation = (
  projectHash: string,
  month: string,
  count: number,
  limit: number,
) => Promise<boolean>;

/** Injectable transport/budget for tests; production uses the shared master DB. */
export function createProductAnalytics(options: {
  env: Record<string, string | undefined>;
  reserve: Reservation;
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => Date;
}) {
  const { env, reserve } = options;
  const token = env.POSTHOG_PROJECT_TOKEN?.trim();
  const enabled =
    env.POSTHOG_ENABLED === "true" &&
    Boolean(token) &&
    (env.POSTHOG_ALLOW_NON_PRODUCTION === "true" ||
      (env.VERCEL_ENV ?? env.NODE_ENV) === "production");
  const limit =
    env.POSTHOG_MONTHLY_EVENT_LIMIT === undefined
      ? 900_000
      : Number(env.POSTHOG_MONTHLY_EVENT_LIMIT);
  const anchor =
    env.POSTHOG_BILLING_CYCLE_START_DAY === undefined
      ? 1
      : Number(env.POSTHOG_BILLING_CYCLE_START_DAY);
  const validAnchor = Number.isInteger(anchor) && anchor >= 1 && anchor <= 28;
  const validLimit = Number.isInteger(limit) && limit >= 0 && limit <= 900_000;
  const configuredRate =
    env.POSTHOG_SEARCH_SAMPLE_RATE === undefined ? 0.1 : Number(env.POSTHOG_SEARCH_SAMPLE_RATE);
  const sampleRate =
    Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 1
      ? configuredRate
      : 0;
  const projectHash = token ? createHash("sha256").update(token).digest("hex") : "";
  const now = options.now ?? (() => new Date());
  const transport = options.fetch ?? globalThis.fetch;
  const random = options.random ?? Math.random;
  type Event = {
    event: AnalyticsEvent;
    distinct_id: string;
    timestamp: string;
    properties: AnalyticsProperties & {
      platform: AnalyticsPlatform;
      sample_rate: number;
      $process_person_profile: false;
      $geoip_disable: true;
    };
  };
  let queue: Event[] = [];
  let pending: Promise<void> | undefined;
  return {
    async capture(input: ProductEventInput): Promise<void> {
      try {
        if (
          !enabled ||
          !validAnchor ||
          !validLimit ||
          !limit ||
          !input.userId ||
          input.platform === "unknown" ||
          !PLATFORMS.includes(input.platform) ||
          !EVENTS.includes(input.event)
        )
          return;
        if (input.event === "search_completed" && random() >= sampleRate) return;
        if (queue.length >= 200) return;
        queue.push({
          event: input.event,
          distinct_id: createHmac("sha256", token!).update(input.userId).digest("hex"),
          timestamp: now().toISOString(),
          properties: {
            ...cleanProperties(input.properties),
            platform: PLATFORMS.includes(input.platform) ? input.platform : "unknown",
            sample_rate: input.event === "search_completed" ? sampleRate : 1,
            $process_person_profile: false,
            $geoip_disable: true,
          },
        });
      } catch {
        /* analytics cannot affect product operations */
      }
    },
    async flush(): Promise<void> {
      try {
        if (pending) await pending;
        if (!enabled || !queue.length) return;
        const snapshot = queue.splice(0, 200);
        const task = (async () => {
          for (let offset = 0; offset < snapshot.length; offset += 50) {
            const batch = snapshot.slice(offset, offset + 50);
            // Reserve at send-time in the anchored UTC billing cycle. Never refund failures:
            // a timeout may have reached PostHog, and refunding could exceed cap.
            let allowed = false;
            try {
              allowed = await bounded(
                reserve(projectHash, analyticsBudgetCycle(now(), anchor), batch.length, limit),
                2000,
              );
            } catch {
              /* fail closed */
            }
            if (!allowed) continue;
            const controller = new AbortController();
            try {
              const response = await bounded(
                transport("https://us.i.posthog.com/batch/", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ api_key: token, batch }),
                  signal: controller.signal,
                  redirect: "error",
                }),
                2000,
              );
              // No retries on any status; discard response text, which may echo data.
              void response.body?.cancel().catch(() => {});
            } catch {
              /* attempted delivery stays charged; never log token/body */
            } finally {
              controller.abort();
            }
          }
        })();
        pending = task;
        await task;
        if (pending === task) pending = undefined;
      } catch {
        /* analytics cannot affect product operations */
      }
    },
  };
}
const store = globalThis as unknown as {
  __bookmarkProductAnalytics?: ReturnType<typeof createProductAnalytics>;
};
function analytics() {
  return (store.__bookmarkProductAnalytics ??= createProductAnalytics({
    env: process.env,
    reserve: async (hash, month, count, limit) => {
      const [{ getMasterContext }, { reserveAnalyticsBudget }] = await Promise.all([
        import("@/lib/server/context"),
        import("@bookmark-ai/db"),
      ]);
      const master = getMasterContext();
      if (!master) return false;
      await master.ready;
      return reserveAnalyticsBudget(master.db, hash, month, count, limit);
    },
  }));
}
export async function captureProductEvent(input: ProductEventInput): Promise<void> {
  try {
    await analytics().capture(input);
  } catch {
    /* fail closed */
  }
}
export async function flushProductAnalytics(): Promise<void> {
  try {
    await analytics().flush();
  } catch {
    /* fail closed */
  }
}
