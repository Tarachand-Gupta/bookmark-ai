// In-memory sliding-window limiter, mirroring the numbers the Express server
// used (120 requests / 60s per key). NOTE: this is per-instance state — on
// serverless each warm instance keeps its own window, so this is coarse
// abuse protection only. Real per-user quotas come later with the master DB.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_KEYS = 10_000;

const hits = new Map<string, number[]>();

/** Returns true if the key is under the limit (request allowed), false if over. */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= MAX_REQUESTS) {
    hits.set(key, timestamps);
    return false;
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

  return true;
}
