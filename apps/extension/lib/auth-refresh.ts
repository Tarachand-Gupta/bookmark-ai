/**
 * FORCED CREDENTIAL REFRESH — the one thing that turns a 401 into a retry
 * instead of a dead end, on every build target.
 *
 * Before this existed, only two things could unstick an extension whose
 * credential had gone bad: the 6h alarm (which never validated the token) and a
 * popup open (`handleGetUser`, the sole place an invalid token was ever cleared).
 * Everything else — bookmark saves, session saves, native-sync mirrors, live
 * pushes — simply failed and told the user to go open the web app. Safari had a
 * one-shot 401 retry for live calls; Chrome and Firefox had nothing.
 *
 * The ladder here is deliberately the CHEAPEST-FIRST order:
 *   1. forced device-token renewal (one POST, old token as bearer — works right
 *      up to real expiry, and CLEARS the token when the server says it's invalid),
 *   2. a fresh Clerk-authed mint through whatever path this browser has (the
 *      background registers it: Native-API session on Chrome/Firefox, the
 *      content-script bridge on Safari).
 *
 * Loop safety: one shared in-flight promise (a burst of 401s pays for ONE
 * refresh) plus a cooldown after a FAILED refresh, so a genuinely signed-out
 * extension can't hammer `/api/device-token`. Callers retry the request at most
 * once — see `authFetch` in lib/api.ts.
 *
 * SECURITY: nothing here logs a token value — event names, outcomes, expiry
 * deltas, and status codes only.
 */

import { renewDeviceTokenIfNeeded } from "./device-token";
import { diag } from "./diag";

/** After a FAILED refresh, don't try again for this long (per worker). A success
 * clears it immediately — the next 401 deserves a fresh attempt. */
const REFRESH_COOLDOWN_MS = 60_000;

/**
 * Registered by the background script: mint a BRAND-NEW device token from a live
 * Clerk session, bypassing the boot latch and the retry backoff. Returns whether
 * a token was stored. Left unset in the popup (and in unit tests), where step 1
 * of the ladder is simply the end of it.
 */
let deviceTokenReminter: (() => Promise<boolean>) | null = null;

export function setDeviceTokenReminter(reminter: () => Promise<boolean>): void {
  deviceTokenReminter = reminter;
}

/** Shared in-flight refresh — the single-flight guard. */
let inFlight: Promise<boolean> | null = null;
/** Epoch ms of the last refresh that came up empty (0 = none this worker). */
let lastFailureAt = 0;

/**
 * Force the auth credential to be replaced, returning whether a NEW usable
 * credential now exists (i.e. whether retrying the request is worth anything).
 * Single-flight and cooldown-guarded; never throws.
 */
export async function refreshCredential(): Promise<boolean> {
  if (inFlight) return inFlight;
  const sinceMs = Date.now() - lastFailureAt;
  if (lastFailureAt !== 0 && sinceMs < REFRESH_COOLDOWN_MS) {
    diag("authRetry", "refresh skipped (cooldown)", { sinceMs });
    return false;
  }
  const attempt = runRefresh();
  inFlight = attempt;
  try {
    return await attempt;
  } finally {
    if (inFlight === attempt) inFlight = null;
  }
}

async function runRefresh(): Promise<boolean> {
  const outcome = await renewDeviceTokenIfNeeded({ force: true });
  diag("authRetry", "forced renewal", { outcome });
  if (outcome === "renewed") {
    lastFailureAt = 0;
    return true;
  }
  // Every other outcome is curable only by a fresh Clerk-authed mint:
  //  - "invalid"   → the token is gone; mint seeds a new chain,
  //  - "reauth"    → the chain hit its server-side cap,
  //  - "none"      → never had one (a Chrome/Firefox install whose Clerk session
  //                  expired before the first mint ever ran),
  //  - "throttled"/"failed" → a fresh worker, or a transient renewal error.
  const minted = (await deviceTokenReminter?.().catch(() => false)) ?? false;
  diag("authRetry", "clerk re-mint", { ok: minted, after: outcome });
  if (minted) {
    lastFailureAt = 0;
    return true;
  }
  lastFailureAt = Date.now();
  return false;
}

/** Test seam: drop the single-flight promise, the cooldown, and the registered
 * reminter so each test starts from a cold worker. */
export function resetAuthRefreshState(): void {
  inFlight = null;
  lastFailureAt = 0;
  deviceTokenReminter = null;
}
