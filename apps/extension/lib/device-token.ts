/**
 * Long-lived DEVICE TOKEN — SAFARI's path to Chrome-parity, seamless auth.
 *
 * Safari 26 partitions the extension's network/cookie context from the browser
 * jar, so none of the SDK / native-cookie / credentialed-fetch paths can see the
 * web Clerk session unless an app tab is OPEN to bridge through (Path D). The fix:
 * mint one opaque, long-lived device token through the bridge the single moment an
 * app tab exists (right after sign-in), persist it here, then present it as a
 * plain `Authorization: Bearer bkd_...` header on EVERY API + live-server call —
 * header auth works fine in Safari's partitioned context where cookies don't. The
 * token self-renews silently, so no reconnect gate with no app tab open.
 *
 * Contract (server built in parallel):
 *  - POST {apiBase}/api/device-token — Clerk-authed (bridge mint) OR
 *    `Authorization: Bearer bkd_...` (renewal) → 200 `{token, expiresInSeconds,
 *    expiresAtMs}`. 401 `{code:"reauth"}` = renewal chain too old (needs a fresh
 *    bridge re-mint); any other 401 = the token is invalid.
 *  - Tokens last 90 days and are OPAQUE strings. SECURITY: never log a token
 *    value — presence/length/status only (see lib/diag.ts).
 */

import { storage } from "#imports";
import { getApiBaseUrl } from "./api";
import { diag } from "./diag";
import { fetchWithTimeout } from "./net";

/** Persisted device-token record. `rti` is reserved for a future renewal-chain
 * issued-at the server may surface; unused today. */
export interface StoredDeviceToken {
  token: string;
  /** Epoch ms when the token expires. */
  exp: number;
  rti?: number;
}

/** Response body of POST /api/device-token (mint and renewal share it). */
export interface DeviceTokenResponse {
  token: string;
  expiresInSeconds?: number;
  expiresAtMs?: number;
}

const deviceTokenItem = storage.defineItem<StoredDeviceToken | null>("local:deviceToken", {
  fallback: null,
});

/** Epoch ms of the last renewal ATTEMPT — throttles renewal to once per 24h even
 * across worker restarts (Safari tears the worker down every couple of minutes). */
const deviceTokenRenewAtItem = storage.defineItem<number>("local:deviceTokenRenewAt", {
  fallback: 0,
});

/** Epoch ms of the last FORCED renewal attempt (401 recovery / near-expiry
 * inline renewal). Forced renewals must bypass the 24h throttle — that's the
 * whole point — so they get their own, much shorter cooldown, persisted for the
 * same reason: a torn-down worker must not forget that it just tried. */
const deviceTokenForceRenewAtItem = storage.defineItem<number>(
  "local:deviceTokenForceRenewAt",
  { fallback: 0 },
);

/** Don't hand out a token with less than this much life left (avoids a request
 * racing its own expiry). */
const MIN_LIFETIME_MS = 60_000;
/** 90-day TTL; renew once past 1/3 of it — i.e. with under 60 days of life left. */
const RENEW_WHEN_REMAINING_MS = 60 * 24 * 60 * 60 * 1000;
/** At most one renewal attempt per 24h, success or failure. */
const RENEW_THROTTLE_MS = 24 * 60 * 60 * 1000;
/** Forced renewals are cheap but must not stampede: at most one per minute, so a
 * burst of 401s (a tab-restore firing twenty saves) costs ONE renewal POST. */
const FORCED_RENEW_COOLDOWN_MS = 60_000;

/** The stored bearer when it's still comfortably valid (> 60s of life), else null. */
export async function getStoredDeviceToken(): Promise<string | null> {
  const stored = await deviceTokenItem.getValue().catch(() => null);
  if (stored && stored.exp > Date.now() + MIN_LIFETIME_MS) return stored.token;
  return null;
}

/**
 * The bearer to actually PUT ON A REQUEST — `getStoredDeviceToken` with a
 * last-chance self-heal. A token inside the final 60s (or already expired but
 * still within the server's renewal grace) used to make this return null, which
 * dropped the caller down the ladder to a Clerk session that may well be gone —
 * the classic "401 until you open the web app" trap. The server accepts the OLD
 * token as the renewal bearer, so try one forced renewal inline (cooldown-guarded)
 * and hand back the replacement.
 */
export async function getUsableDeviceToken(): Promise<string | null> {
  const stored = await deviceTokenItem.getValue().catch(() => null);
  if (!stored) return null;
  const remaining = stored.exp - Date.now();
  if (remaining > MIN_LIFETIME_MS) return stored.token;
  diag("deviceToken", "near expiry: inline renewal", { remainingMs: remaining });
  await renewDeviceTokenIfNeeded({ force: true });
  const after = await deviceTokenItem.getValue().catch(() => null);
  if (after && after.exp > Date.now() + MIN_LIFETIME_MS) return after.token;
  return null;
}

/** Persist a freshly minted/renewed token. Prefers the server's absolute
 * `expiresAtMs`, else derives it from `expiresInSeconds`. */
export async function storeDeviceToken(body: DeviceTokenResponse): Promise<void> {
  const exp =
    typeof body.expiresAtMs === "number"
      ? body.expiresAtMs
      : Date.now() + Math.max(0, (body.expiresInSeconds ?? 0) * 1000);
  await deviceTokenItem.setValue({ token: body.token, exp }).catch(() => {});
}

/** Forget the token (invalid, or signed out). */
export async function clearDeviceToken(): Promise<void> {
  await deviceTokenItem.setValue(null).catch(() => {});
}

/** True when a stored token is past 1/3 of its TTL and so due for renewal (or a
 * fresh bridge re-mint). Null token → false (a first mint is handled elsewhere). */
export async function isDeviceTokenRenewalDue(): Promise<boolean> {
  const stored = await deviceTokenItem.getValue().catch(() => null);
  if (!stored) return false;
  return stored.exp - Date.now() <= RENEW_WHEN_REMAINING_MS;
}

/** Read a JSON error body's `code` field, tolerating a missing/unparseable body. */
async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: string };
    return body?.code ?? null;
  } catch {
    return null;
  }
}

/**
 * What a renewal attempt concluded. The 401-recovery ladder
 * (lib/auth-refresh.ts) branches on this to decide whether a fresh Clerk-authed
 * mint is the only remaining cure.
 */
export type RenewOutcome =
  /** No stored token at all — only a fresh mint can seed one. */
  | "none"
  /** Comfortably far from expiry; nothing was attempted (unforced calls only). */
  | "fresh"
  /** An attempt happened too recently (24h scheduled window / 60s forced cooldown). */
  | "throttled"
  /** A replacement token is stored. */
  | "renewed"
  /** 401 `{code:"reauth"}`: the renewal chain is too old. Token KEPT. */
  | "reauth"
  /** 401 (any other code): the token is invalid and has been CLEARED. */
  | "invalid"
  /** Non-401 status, unparseable body, or network error. Token kept. */
  | "failed";

/**
 * Renew the device token. Renewal is a plain Bearer POST (no bridge, no
 * credentials) — header auth is all Safari needs. Outcomes above.
 *
 * Unforced (the scheduled path): only acts once the token is within the last 2/3
 * of its life, at most once per 24h.
 *
 * `force: true` (401 recovery, near-expiry inline renewal): renews regardless of
 * how much life is left, on a 60s cooldown instead of the 24h throttle. The
 * server accepts the current token as the renewal bearer right up to its real
 * expiry, so this is the cheapest possible self-heal.
 */
export async function renewDeviceTokenIfNeeded(
  options: { force?: boolean } = {},
): Promise<RenewOutcome> {
  const force = options.force === true;
  const stored = await deviceTokenItem.getValue().catch(() => null);
  if (!stored) return "none"; // nothing to renew — a mint seeds the first token
  const remaining = stored.exp - Date.now();
  if (!force && remaining > RENEW_WHEN_REMAINING_MS) return "fresh";

  // The persisted cooldown below CANNOT collapse a concurrent burst: twenty
  // near-expiry requests (a tab restore firing twenty saves) all read the
  // last-attempt stamp before any of them writes it, so all twenty would POST.
  // One shared in-flight promise is what actually makes it a single renewal.
  if (renewInFlight) return renewInFlight;
  const attempt = postRenewal(stored, force, remaining);
  renewInFlight = attempt;
  try {
    return await attempt;
  } finally {
    if (renewInFlight === attempt) renewInFlight = null;
  }
}

/** Shared in-flight renewal — see the burst comment in `renewDeviceTokenIfNeeded`. */
let renewInFlight: Promise<RenewOutcome> | null = null;

/** The cooldown check plus the renewal POST itself. Never called concurrently. */
async function postRenewal(
  stored: StoredDeviceToken,
  force: boolean,
  remaining: number,
): Promise<RenewOutcome> {
  const now = Date.now();
  // Forced and scheduled attempts keep SEPARATE clocks: a forced attempt must
  // never be blocked by (nor consume) the 24h scheduled window.
  const attemptItem = force ? deviceTokenForceRenewAtItem : deviceTokenRenewAtItem;
  const cooldownMs = force ? FORCED_RENEW_COOLDOWN_MS : RENEW_THROTTLE_MS;
  const lastAt = await attemptItem.getValue().catch(() => 0);
  if (now - lastAt < cooldownMs) {
    diag("deviceToken", "renew throttled", { force, sinceMs: now - lastAt });
    return "throttled";
  }
  await attemptItem.setValue(now).catch(() => {});

  const base = await getApiBaseUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${stored.token}` },
      body: "{}",
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as DeviceTokenResponse | null;
      if (body?.token) {
        await storeDeviceToken(body);
        diag("deviceToken", "renewed", { status: res.status, force, remainingMs: remaining });
        return "renewed";
      }
      diag("deviceToken", "renew: no token in body", { status: res.status });
      return "failed";
    }
    if (res.status === 401) {
      const code = await readErrorCode(res);
      if (code === "reauth") {
        diag("deviceToken", "renew: reauth (kept)", { status: 401 });
        return "reauth";
      }
      await clearDeviceToken();
      diag("deviceToken", "renew: invalid (cleared)", { status: 401 });
      return "invalid";
    }
    diag("deviceToken", "renew failed", { status: res.status });
    return "failed";
  } catch (e) {
    diag("deviceToken", "renew error", { error: e instanceof Error ? e.message : String(e) });
    return "failed";
  }
}
