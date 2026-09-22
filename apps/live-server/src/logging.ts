import { createServerLogger } from "@bookmark-ai/server-logging";
import type { FastifyInstance } from "fastify";

export type LiveLogger = ReturnType<typeof createServerLogger>;

/** Only route templates and operational counters leave this server. */
export function registerServerLogging(
  app: FastifyInstance,
  logger: LiveLogger = createServerLogger({ service: "bookmark-ai-live" }),
  flushIntervalMs = 5_000,
): LiveLogger {
  app.addHook("onResponse", async (request, reply) => {
    logger.log(reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info", "http.request.completed", {
      method: request.method,
      route: request.routeOptions.url ?? "/unmatched",
      status: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });
  app.addHook("onError", async (request, reply, error) => {
    logger.log("error", "http.request.failed", {
      method: request.method,
      route: request.routeOptions.url ?? "/unmatched",
      status: error.statusCode ?? (reply.statusCode >= 400 ? reply.statusCode : 500),
      error,
    });
  });
  // Awaitable, non-overlapping flushes; the transport bounds each HTTP attempt.
  let flushing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!flushing) flushing = logger.flush().catch(() => {}).finally(() => { flushing = undefined; });
  }, flushIntervalMs);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await flushing;
    await logger.flush();
  });
  return logger;
}
