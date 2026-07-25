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

/** Don't hand out a token with less than this much life left (avoids a request
 * racing its own expiry). */
const MIN_LIFETIME_MS = 60_000;
/** 90-day TTL; renew once past 1/3 of it — i.e. with under 60 days of life left. */
const RENEW_WHEN_REMAINING_MS = 60 * 24 * 60 * 60 * 1000;
/** At most one renewal attempt per 24h, success or failure. */
const RENEW_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** The stored bearer when it's still comfortably valid (> 60s of life), else null. */
export async function getStoredDeviceToken(): Promise<string | null> {
  const stored = await deviceTokenItem.getValue().catch(() => null);
  if (stored && stored.exp > Date.now() + MIN_LIFETIME_MS) return stored.token;
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
 * Silently renew the device token when it's within the last 2/3 of its life,
 * throttled to at most once per 24h. Renewal is a plain Bearer POST (no bridge,
 * no credentials) — header auth is all Safari needs. Outcomes:
 *  - 200 → store the new token.
 *  - 401 `{code:"reauth"}` → the renewal chain is too old; LEAVE the token in
 *    place so the mirror keeps working until a bridge re-mint replaces it.
 *  - other 401 → the token is invalid; clear it.
 *  - non-401 / network error → leave the token, retry after the throttle window.
 */
export async function renewDeviceTokenIfNeeded(): Promise<void> {
  const stored = await deviceTokenItem.getValue().catch(() => null);
  if (!stored) return; // nothing to renew — a bridge mint seeds the first token
  const now = Date.now();
  if (stored.exp - now > RENEW_WHEN_REMAINING_MS) return; // still fresh

  const lastAt = await deviceTokenRenewAtItem.getValue().catch(() => 0);
  if (now - lastAt < RENEW_THROTTLE_MS) return; // already tried within 24h
  await deviceTokenRenewAtItem.setValue(now).catch(() => {});

  const base = await getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${stored.token}` },
      body: "{}",
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as DeviceTokenResponse | null;
      if (body?.token) {
        await storeDeviceToken(body);
        diag("deviceToken", "renewed", { status: res.status });
      } else {
        diag("deviceToken", "renew: no token in body", { status: res.status });
      }
      return;
    }
    if (res.status === 401) {
      const code = await readErrorCode(res);
      if (code === "reauth") {
        diag("deviceToken", "renew: reauth (kept)", { status: 401 });
      } else {
        await clearDeviceToken();
        diag("deviceToken", "renew: invalid (cleared)", { status: 401 });
      }
      return;
    }
    diag("deviceToken", "renew failed", { status: res.status });
  } catch (e) {
    diag("deviceToken", "renew error", { error: e instanceof Error ? e.message : String(e) });
  }
}
