import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * MCP TOKENS — the bearer credential an external MCP client (Claude Code, Claude
 * Desktop, any agent host) attaches to `POST /api/mcp`.
 *
 * Modeled on device-token.ts, deliberately: same HS256-over-`DEVICE_TOKEN_SECRET`
 * self-signed compact JWT, same `.`→`~` swap on the wire. The swap is
 * LOAD-BEARING, not cosmetic: a dotted three-segment bearer looks like a session
 * JWT to Clerk's middleware, which tries to parse it and crashes the whole
 * request with MIDDLEWARE_INVOCATION_FAILED before the route ever runs (verified
 * against prod). It reuses `DEVICE_TOKEN_SECRET` rather than introducing a second
 * secret — the two token families are already distinguished by their prefix AND
 * by the `scp` claim, so no cross-honoring is possible.
 *
 * Claims: `sub` (Clerk user id), `iat`, `exp` = iat + 365d, `jti` (random 16-byte
 * hex id — the primary key of the `mcp_tokens` row, which is what makes a token
 * REVOCABLE), `scp` = "mcp" (verifiers REJECT any other value, so a device token
 * can never authenticate the MCP surface and vice-versa).
 *
 * SCOPE: signature validity alone is NOT sufficient. /api/mcp additionally
 * requires the `jti` row to exist with `revoked_at IS NULL`, which is the
 * revocation path; and the MCP surface is read/search/save only — it can neither
 * delete library data nor manage tokens (the /api/mcp/tokens routes require a
 * real Clerk session).
 *
 * SECURITY: token values are secrets — never log them (or their signatures).
 */

/** Wire prefix distinguishing an MCP token from a device token / Clerk JWT. */
export const MCP_TOKEN_PREFIX = "bkmcp_";

/** Token lifetime: 365 days. There is no renewal path — the user mints a new
 * token in Settings and revokes the old one. */
export const MCP_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Clock-skew tolerance when checking `exp` (seconds). */
const CLOCK_SKEW_SECONDS = 30;

/** The only scope this family ever carries. */
const MCP_TOKEN_SCOPE = "mcp";

type McpTokenClaims = {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  scp: string;
};

export type MintedMcpToken = {
  token: string;
  /** The `jti` — insert this as the `mcp_tokens` row id. */
  id: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type VerifiedMcpToken = {
  userId: string;
  tokenId: string;
  iat: number;
  exp: number;
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

/** True when the signing secret is present — i.e. the MCP surface is usable at
 * all. Routes map `false` to a 503 instead of silently 401ing every client. */
export function isMcpConfigured(): boolean {
  return secretBytes() !== null;
}

/**
 * Mint an MCP token for `userId`. Throws only when the secret is missing;
 * callers reach here having already authenticated a Clerk session, so that is a
 * server misconfiguration, not a user error.
 */
export function mintMcpToken(userId: string): MintedMcpToken {
  const key = secretBytes();
  if (!key) throw new Error("DEVICE_TOKEN_SECRET is not set — cannot mint MCP tokens");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + MCP_TOKEN_TTL_SECONDS;
  const jti = randomBytes(16).toString("hex");

  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({ sub: userId, iat, exp, jti, scp: MCP_TOKEN_SCOPE }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64urlEncode(sign(signingInput, key));

  return {
    // `.` → `~` so the bearer is not JWT-shaped on the wire (see header comment).
    token: `${MCP_TOKEN_PREFIX}${`${signingInput}.${signature}`.replaceAll(".", "~")}`,
    id: jti,
    issuedAtMs: iat * 1000,
    expiresAtMs: exp * 1000,
  };
}

/**
 * Derive the stored display hint for a token: `bkmcp_` + the first 5 characters
 * of the token body + `…` + its last 5. Pure, and accepts the value with OR
 * without the `bkmcp_` prefix (the prefix is stripped first, so both forms yield
 * the identical hint) — the mint path passes the full token, tests pass either.
 *
 * WHY it exists: the token value is never stored, so a Settings list of three
 * tokens otherwise offers nothing to match against the credential sitting in a
 * given client's config file. The hint is deliberately NON-REVERSIBLE: 10
 * characters out of a ~260-character token, enough to say "this row is that
 * token", useless for authenticating (the signature is what a verifier checks,
 * and none of it survives here in a reconstructable form). Safe to store in the
 * tenant DB and to render in the UI.
 *
 * DEGRADE PATH for a body shorter than 10 characters (truncated value, a bare
 * prefix, an empty string — none of which a minted token ever is): the two
 * slices would overlap and echo the whole body back, so anything under 12 chars
 * collapses to the prefix plus a bare `…`. Never reveals the full value, never
 * throws.
 */
export function mcpTokenHint(token: string): string {
  const raw = typeof token === "string" ? token : "";
  // Only a LEADING prefix is stripped (String.replace would happily eat an
  // occurrence from the middle of the base64url body).
  const body = raw.startsWith(MCP_TOKEN_PREFIX) ? raw.slice(MCP_TOKEN_PREFIX.length) : raw;
  // 12, not 10: at exactly 10 the two 5-char windows tile the entire body, and at
  // 11 a single hidden character is a fig leaf. Below that, show no body at all.
  if (body.length < 12) return `${MCP_TOKEN_PREFIX}…`;
  return `${MCP_TOKEN_PREFIX}${body.slice(0, 5)}…${body.slice(-5)}`;
}

/**
 * Verify an MCP token's signature and claims. Returns null on ANY failure
 * (missing secret, wrong prefix, malformed structure, wrong alg, bad signature,
 * expiry past the skew tolerance, or a scope other than "mcp"). Signature
 * comparison is timing-safe. Revocation is NOT checked here — that needs the
 * user's DB and is the caller's job.
 */
export function verifyMcpToken(token: string): VerifiedMcpToken | null {
  const key = secretBytes();
  if (!key) return null;
  if (typeof token !== "string" || !token.startsWith(MCP_TOKEN_PREFIX)) return null;

  const compact = token.slice(MCP_TOKEN_PREFIX.length).replaceAll("~", ".");
  const parts = compact.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  let header: { alg?: string; typ?: string };
  let claims: Partial<McpTokenClaims>;
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

  const { sub, iat, exp, jti, scp } = claims;
  if (
    typeof sub !== "string" ||
    !sub ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    typeof jti !== "string" ||
    !jti ||
    scp !== MCP_TOKEN_SCOPE // a device token (scp "ext") must never pass here
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp + CLOCK_SKEW_SECONDS) return null;

  return { userId: sub, tokenId: jti, iat, exp };
}
