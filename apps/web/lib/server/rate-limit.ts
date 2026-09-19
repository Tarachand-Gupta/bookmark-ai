// In-memory sliding-window limiter, mirroring the numbers the Express server
// used (120 requests / 60s per key). NOTE: this is per-instance state — on
// serverless each warm instance keeps its own window, so this is coarse
// abuse protection only. Real per-user quotas come later with the master DB.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_KEYS = 10_000;

const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * A namespaced sliding window used by public flows with their own legitimate
 * cadence. Callers own the namespace in `key`; the shared bounded map keeps the
 * same per-instance abuse-protection behavior as the general API limiter.
 */
export function checkRateLimitWindow(
  key: string,
  maxRequests: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;

  const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= maxRequests) {
    hits.set(key, timestamps);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1_000)),
    };
  }

  timestamps.push(now);
  hits.set(key, timestamps);

  // Bound memory: Map preserves insertion order, so the first keys are the
  // oldest — evict them until back under the cap.
  if (hits.size > MAX_KEYS) {
    for (const oldest of hits.keys()) {
      hits.delete(oldest);
      if (hits.size <= MAX_KEYS) break;
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Returns true if the key is under the general API limit. */
export function checkRateLimit(key: string): boolean {
  return checkRateLimitWindow(key, MAX_REQUESTS, WINDOW_MS).allowed;
}
