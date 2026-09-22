/** Server-only, explicit structured logs. Never pass request bodies, URLs, or user data. */
export type LogLevel = "info" | "warn" | "error";
export interface LogFields {
  /** Static route template, e.g. /api/bookmarks/[id], never a request URL. */
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  /** Static operation name, never user-supplied text. */
  operation?: string;
  /** Only a built-in error category is recorded; message/stack/cause are discarded. */
  error?: unknown;
}
const ranks = { info: 0, warn: 1, error: 2 };
const endpoints = {
  US: "https://log-api.newrelic.com/log/v1",
  EU: "https://log-api.eu.newrelic.com/log/v1",
  JP: "https://log-api.jp.nr-data.net/log/v1",
};
const MAX_QUEUE = 200;
const MAX_BATCH = 100;
const TIMEOUT_MS = 2000;
const token = (value: string | undefined, fallback: string) =>
  value && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) ? value : fallback;
function fieldsForLog(fields: LogFields): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (fields.route && /^\/[a-zA-Z0-9_/\[\]:.-]{0,160}$/.test(fields.route)) result.route = fields.route;
  if (fields.method && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(fields.method)) result.method = fields.method;
  if (Number.isInteger(fields.status) && fields.status! >= 100 && fields.status! <= 599) result.status = fields.status!;
  if (typeof fields.durationMs === "number" && Number.isFinite(fields.durationMs)) result.durationMs = Math.max(0, Math.round(fields.durationMs));
  if (fields.operation) result.operation = token(fields.operation, "unknown");
  if (fields.error !== undefined) {
    // Do not read custom name/message/stack getters or serialize the error object.
    result.errorType = fields.error instanceof TypeError ? "TypeError"
      : fields.error instanceof RangeError ? "RangeError"
      : fields.error instanceof SyntaxError ? "SyntaxError"
      : fields.error instanceof Error ? "Error" : "UnknownError";
  }
  return result;
}
export function createServerLogger(options: {
  service: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  console?: Pick<Console, "log" | "warn" | "error">;
}) {
  const env = options.env ?? process.env;
  const output = options.console ?? console;
  const transport = options.fetch ?? globalThis.fetch;
  const key = env.NEW_RELIC_LICENSE_KEY?.trim();
  const region = (env.NEW_RELIC_REGION ?? "US").toUpperCase();
  // An invalid region must not silently send data to another geography.
  const endpoint = endpoints[region as keyof typeof endpoints];
  const level = env.NEW_RELIC_LOG_LEVEL;
  const minimum = level === "warn" || level === "error" ? ranks[level] : ranks.info;
  const common = {
    "service.name": token(options.service, "bookmark-ai"),
    environment: token(env.VERCEL_ENV ?? env.NODE_ENV, "development"),
  };
  type Entry = { timestamp: number; message: string; attributes: Record<string, string | number> };
  let queue: Entry[] = [];
  let pending: Promise<void> | undefined;
  let lastWarning = 0;
  function warn(reason: string) {
    if (Date.now() - lastWarning < 60_000) return;
    lastWarning = Date.now();
    try { output.warn(JSON.stringify({ message: "log_delivery_failed", reason, ...common })); } catch { /* logging must not break work */ }
  }
  return {
    log(level: LogLevel, event: string, fields: LogFields = {}): void {
      try {
        if (ranks[level] < minimum) return;
        const entry: Entry = { timestamp: Date.now(), message: token(event, "server_event"), attributes: { level, ...fieldsForLog(fields) } };
        output[level === "info" ? "log" : level](JSON.stringify({ ...entry, ...common }));
        if (!key) return;
        if (!endpoint) { warn("invalid_region"); return; }
        if (queue.length >= MAX_QUEUE) { queue.shift(); warn("queue_full"); }
        queue.push(entry);
      } catch { /* formatting/console failure must not affect a request */ }
    },
    async flush(): Promise<void> {
      // Drain a bounded snapshot. Concurrent calls join it then drain anything
      // queued meanwhile, so a later after() callback cannot strand its logs.
      if (pending) await pending;
      if (!queue.length || !key || !endpoint) return;
      const snapshot = queue.splice(0, MAX_QUEUE);
      const task = (async () => {
        for (let offset = 0; offset < snapshot.length; offset += MAX_BATCH) {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const request = transport(endpoint, {
              method: "POST", headers: { "Content-Type": "application/json", "Api-Key": key },
              body: JSON.stringify([{ common: { attributes: common }, logs: snapshot.slice(offset, offset + MAX_BATCH) }]),
              signal: controller.signal,
              redirect: "error",
            });
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, TIMEOUT_MS);
            });
            const response = await Promise.race([request, timeout]);
            if (!response.ok) warn(`http_${response.status}`);
            // Responses carry no useful application data; do not retain/read them.
            void response.body?.cancel().catch(() => {});
          } catch { warn("transport_error"); }
          finally { if (timer) clearTimeout(timer); }
        }
      })();
      pending = task;
      await task;
      if (pending === task) pending = undefined;
    },
  };
}
