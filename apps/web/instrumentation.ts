import type { Instrumentation } from "next";

/**
 * Next.js instrumentation hook — runs once per server process, before any
 * request. The observability wiring is Node-only (OTel span processor,
 * AsyncLocalStorage context manager), so it's gated on the runtime and
 * imported dynamically to keep it out of the edge/client graphs entirely.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/server/observability/register");
  }
}

/** Next awaits error reporting. Raw request paths/headers and error text stay local. */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { serverLogger } = await import("./lib/server/observability/server-logs");
  serverLogger.log("error", "framework_request_failed", {
    route: context.routePath,
    operation: context.routeType,
    error,
  });
  await serverLogger.flush();
};
