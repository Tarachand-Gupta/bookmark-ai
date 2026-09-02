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
