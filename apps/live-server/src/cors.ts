/**
 * CORS origin resolution shared between `@fastify/cors` (normal routes) and the
 * hijacked SSE response (which bypasses the plugin's onSend hook, so it needs the
 * header written manually). An empty allowlist means "reflect any origin" — the
 * dev default; production sets LIVE_ALLOWED_ORIGINS explicitly.
 */
export function resolveAllowedOrigin(
  origin: string | undefined,
  allowed: string[],
): string | null {
  if (!origin) return null;
  if (allowed.length === 0) return origin;
  return allowed.includes(origin) ? origin : null;
}

/** ACAO headers to write on a hijacked SSE response for an allowed origin. */
export function sseCorsHeaders(
  origin: string | undefined,
  allowed: string[],
): Record<string, string> {
  const resolved = resolveAllowedOrigin(origin, allowed);
  if (!resolved) return {};
  return { "Access-Control-Allow-Origin": resolved, Vary: "Origin" };
}
