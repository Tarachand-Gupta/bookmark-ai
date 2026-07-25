import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Device-token VERIFY (live-server copy). The Safari extension holds a long-lived
 * `bkd_…` device token and attaches it as `Authorization: Bearer` to BOTH the Next
 * API and this server. This is a verify-ONLY duplicate — apps/web/lib/server/device-token.ts
 * is the SOURCE OF TRUTH for the token format and the minting half. The two apps
 * deliberately don't share a workspace package: live-server keeps zero workspace
 * deps beyond @bookmark-ai/types, so the ~40 lines below are copied intentionally.
 * Keep them byte-compatible with the web verifier if the format ever changes.
 *
 * Format: `bkd_` prefix + JWT compact serialization, HS256 over the utf8 bytes of
 * DEVICE_TOKEN_SECRET. Claims: sub (Clerk user id), iat, exp, rti (root issued-at),
 * scp (scope — must be "ext"; any other value is rejected so tokens minted with a
 * future broader scope are never honored by a server that predates it). Live ops
 * are entirely within the extension scope, so no per-route check is needed here.
 *
 * SECURITY: never log token values or signatures.
 */

/** Wire prefix distinguishing a device token from a Clerk session JWT. */
export const DEVICE_TOKEN_PREFIX = "bkd_";

/** Clock-skew tolerance when checking `exp` (seconds). */
const CLOCK_SKEW_SECONDS = 30;

export type VerifiedDeviceToken = {
  userId: string;
  iat: number;
  exp: number;
  rti: number;
};

function sign(signingInput: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(signingInput).digest();
}

/**
 * Verify a device token against `secret` (raw utf8 bytes of DEVICE_TOKEN_SECRET).
 * Returns the claims on success, or `null` on ANY failure (empty secret, wrong
 * prefix, malformed structure, wrong alg, bad signature, or expiry past skew).
 * Signature comparison is timing-safe.
 */
export function verifyDeviceToken(token: string, secret: string | undefined): VerifiedDeviceToken | null {
  if (!secret) return null;
  const key = Buffer.from(secret, "utf8");
  if (typeof token !== "string" || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;

  const compact = token.slice(DEVICE_TOKEN_PREFIX.length);
  const parts = compact.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: { alg?: string; typ?: string };
  let claims: { sub?: unknown; iat?: unknown; exp?: unknown; rti?: unknown; scp?: unknown };
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
    scp !== "ext" // extension scope only — mirrors the web verifier
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp + CLOCK_SKEW_SECONDS) return null;

  return { userId: sub, iat, exp, rti };
}
