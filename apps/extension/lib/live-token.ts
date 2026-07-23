/**
 * Pure helper for the Safari live-token cache (see lib/api.ts `getLiveToken`).
 * Standalone (no `wxt/browser`) so it is unit-testable in plain node.
 */

export interface CachedToken {
  token: string;
  /** Epoch ms when the token expires. */
  exp: number;
}

/**
 * True when `cache` is present and still has MORE than `skewMs` of life left at
 * `now` — i.e. safe to reuse. Refresh (mint a new one) when this is false, so a
 * token is never used within `skewMs` of expiry (or on a 401-retry, which forces
 * a refresh regardless).
 */
export function tokenFresh(cache: CachedToken | null, now: number, skewMs: number): boolean {
  return cache !== null && cache.exp - now > skewMs;
}
