import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Long-lived DEVICE TOKENS — the browser extension's durable header-auth path.
 *
 * WHY this exists: Safari fully partitions a web-extension's storage/cookies from
 * the web app's Clerk session, so the extension can never see or reuse the signed-in
 * web session the way Chrome's `syncHost` does. A device token is the ONE credential
 * the extension can hold and attach as `Authorization: Bearer bkd_…` to BOTH the
 * Next API and the Fastify live server, with no Clerk visibility required at request
 * time. It's a self-contained HS256 JWT we mint and verify ourselves (Clerk stays the
 * source of identity — a token is only minted for an already-authenticated user).
 *
 * Format: the `bkd_` prefix followed by JWT compact serialization with `.` swapped
 * for `~`, signed HS256 with the raw utf8 bytes of `DEVICE_TOKEN_SECRET`. The swap is
 * LOAD-BEARING, not cosmetic: a dotted three-segment bearer looks like a session JWT
 * to Clerk's middleware, which tries to parse it and crashes the whole request with
 * MIDDLEWARE_INVOCATION_FAILED before requireUser ever runs (verified against prod).
 * Claims: `sub` (Clerk user id), `iat`, `exp` = iat + 90d,
 * `rti` (root issued-at — the start of the renewal chain, preserved across renewals),
 * `scp` (scope — always `"ext"` today; verifiers REJECT any other value so a future
 * broader scope can never be honored by servers that predate it).
 * The live server carries a verify-only copy in apps/live-server/src/device-token.ts.
 *
 * SCOPE: a device token is deliberately NOT a full-power credential. Even though it
 * authenticates a real user for 90 days, requireUser() only honors it on the handful
 * of routes the extension actually needs (save bookmark/session, /api/me, renewal,
 * settings read — see DEVICE_TOKEN_ROUTES in require-user.ts), so a stolen token
 * cannot read/search/export the library, delete data, or drive the chat agent.
 *
 * SECURITY: token values are secrets — never log them (or their signatures) anywhere.
 */

/** Wire prefix distinguishing a device token from a Clerk session JWT. */
export const DEVICE_TOKEN_PREFIX = "bkd_";

/** Token lifetime: 90 days. Each renewal mints a fresh 90-day token. */
export const DEVICE_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Renewal-chain cap: 365 days from the ROOT issued-at (`rti`). Past this, a renewal
 * authenticated by a device token is refused and the extension must re-auth through
 * Clerk (which starts a fresh chain with a new `rti`).
 */
export const DEVICE_TOKEN_ROOT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Clock-skew tolerance when checking `exp` (seconds). */
const CLOCK_SKEW_SECONDS = 30;

/** The only scope minted today: the extension's save/live surface. */
const DEVICE_TOKEN_SCOPE = "ext";

type DeviceTokenClaims = {
  sub: string;
  iat: number;
  exp: number;
  rti: number;
  scp: string;
};

export type MintedDeviceToken = {
  token: string;
  expiresInSeconds: number;
  expiresAtMs: number;
  rti: number;
};

export type VerifiedDeviceToken = {
  userId: string;
  iat: number;
  exp: number;
  rti: number;
};

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function secretBytes(): Buffer | null {
  const secret = process.env.DEVICE_TOKEN_SECRET;
  if (!secret) return null;
  return Buffer.from(secret, "utf8");
}

function sign(signingInput: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(signingInput).digest();
}

/**
 * Mint a device token for `userId`. Pass `rootIatSeconds` to preserve an existing
 * renewal chain's root (on renewal); omit it to start a fresh chain (Clerk auth).
 * Returns `null`-free values but throws only if the secret is missing — callers that
 * reach here have already gated on Clerk, so a missing secret is a server misconfig.
 */
export function mintDeviceToken(userId: string, rootIatSeconds?: number): MintedDeviceToken {
  const key = secretBytes();
  if (!key) throw new Error("DEVICE_TOKEN_SECRET is not set — cannot mint device tokens");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + DEVICE_TOKEN_TTL_SECONDS;
  const rti = rootIatSeconds ?? iat;

  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({ sub: userId, iat, exp, rti, scp: DEVICE_TOKEN_SCOPE }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64urlEncode(sign(signingInput, key));

  return {
    // `.` → `~` so the bearer is not JWT-shaped on the wire (see header comment).
    token: `${DEVICE_TOKEN_PREFIX}${`${signingInput}.${signature}`.replaceAll(".", "~")}`,
    expiresInSeconds: DEVICE_TOKEN_TTL_SECONDS,
    expiresAtMs: exp * 1000,
    rti,
  };
}

/**
 * Verify a device token. Returns the claims on success, or `null` on ANY failure
 * (missing secret, wrong prefix, malformed structure, wrong alg, bad signature, or
 * expiry past the skew tolerance). Signature comparison is timing-safe.
 */
export function verifyDeviceToken(token: string): VerifiedDeviceToken | null {
  const key = secretBytes();
  if (!key) return null;
  if (typeof token !== "string" || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;

  const compact = token.slice(DEVICE_TOKEN_PREFIX.length).replaceAll("~", ".");
  const parts = compact.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: { alg?: string; typ?: string };
  let claims: Partial<DeviceTokenClaims>;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (header.alg !== "HS256") return null;

  const expected = sign(`${headerB64}.${payloadB64}`, key);
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureB64, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  const { sub, iat, exp, rti, scp } = claims;
  if (
    typeof sub !== "string" ||
    !sub ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    typeof rti !== "number" ||
    scp !== DEVICE_TOKEN_SCOPE // unknown/absent scope = not a token we honor
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp + CLOCK_SKEW_SECONDS) return null;

  return { userId: sub, iat, exp, rti };
}
