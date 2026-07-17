import { storage } from "#imports";

/**
 * Durable state for the live-tabs checkpoint loop. Everything the background
 * worker relies on across terminations lives here, never in a worker global —
 * a cached `enabled` that outlives a revoke is a privacy incident (§4.5), so
 * the flag is re-read on every wake. The dirty flag survives a worker killed
 * mid-debounce so the heartbeat alarm can re-send it, and the backoff clock
 * keeps a failing push from 401-spamming.
 */

/** This device's local publish switch — the second key of the two-key model
 * (§5.2). Gates the whole loop; default off (privacy-by-default, §5.1). The
 * account flag on the server gates independently; both must be true to publish. */
export const liveEnabledItem = storage.defineItem<boolean>("local:liveEnabled", {
  fallback: false,
});

/** Set by every tab/window listener, cleared only on a 2xx full push. A worker
 * killed mid-debounce leaves this set so the heartbeat alarm re-sends it. */
export const liveDirtyItem = storage.defineItem<boolean>("local:liveDirty", {
  fallback: false,
});

/** Epoch ms before which pushes are suppressed (exponential backoff, §4.5). */
export const liveBackoffUntilItem = storage.defineItem<number>("local:liveBackoffUntil", {
  fallback: 0,
});

/** Index into the backoff schedule; reset to 0 on any success. */
export const liveBackoffStepItem = storage.defineItem<number>("local:liveBackoffStep", {
  fallback: 0,
});
