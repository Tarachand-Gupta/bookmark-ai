import crypto from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyToken } from "@clerk/backend";
import type { FastifyReply, FastifyRequest } from "fastify";
import { makeAuthPreHandler } from "./auth";
import type { Config } from "./config";

/**
 * Offline auth tests using the pinned-key mode (CLERK_JWT_KEY + CLERK_ISSUER), so
 * no network / real Clerk instance is needed. We mint an RSA keypair, hand the
 * SPKI public-key PEM to the verifier as `clerkJwtKey`, and sign RS256
 * session-shaped JWTs to prove the azp origin rule:
 *   (a) azp in the allowlist        → authorized (sets req.userId)
 *   (b) NO azp (server-minted token) → MUST pass  ← the Safari /api/live-token fix
 *   (c) azp present but not allowed  → 401
 * Run with `pnpm --filter @bookmark-ai/live-server test`.
 *
 * loadClerkJwkFromPem in @clerk/backend derives the JWK modulus from a standard
 * RSA-2048 (e=65537) SPKI PEM, which is exactly what node:crypto emits below.
 */

const ISSUER = "https://test.issuer.example";
const ALLOWED_PARTY = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const SUBJECT = "user_3GIhPt5Na3tYRP3XaPPU3PpI55e";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const b64url = (input: string): string => Buffer.from(input).toString("base64url");

/** Sign a session-shaped RS256 JWT with the test private key. */
function signSessionJwt(extra: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: SUBJECT,
    sid: "sess_test_1234567890",
    iat: now,
    exp: now + 60,
    iss: ISSUER,
    ...extra,
  };
  const header = { alg: "RS256", typ: "JWT", kid: "ins_test_key" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 8080,
    redisUrl: "redis://127.0.0.1:6379",
    clerkSecretKey: undefined,
    clerkJwtKey: publicKey, // pinned-key mode → offline, no JWKS fetch
    clerkIssuer: ISSUER,
    allowedUserIds: [],
    authorizedParties: [ALLOWED_PARTY],
    allowedOrigins: [],
    ttlDays: 7,
    ttlSeconds: 604800,
    ttlHours: 168,
    pushQuotaPerDay: 2000,
    fanoutCoalesceMs: 500,
    refreshEmitMs: 60000,
    devOpen: false,
    isProduction: false,
    ...overrides,
  };
}

interface Captured {
  status: number | null;
  body: unknown;
}

/** Drive the preHandler with a Bearer token; capture the outcome. */
async function runAuth(
  config: Config,
  token: string | null,
): Promise<{ userId: string | undefined; res: Captured }> {
  const res: Captured = { status: null, body: undefined };
  const reply = {
    code(n: number) {
      res.status = n;
      return reply;
    },
    async send(b: unknown) {
      res.body = b;
      return reply;
    },
  } as unknown as FastifyReply;
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as FastifyRequest;

  const authenticate = makeAuthPreHandler(config);
  await authenticate(req, reply);
  return { userId: (req as { userId?: string }).userId, res };
}

test("(a) azp in the authorized-parties allowlist → authorized", async () => {
  const token = signSessionJwt({ azp: ALLOWED_PARTY });
  const { userId, res } = await runAuth(makeConfig(), token);
  assert.equal(res.status, null, "no error response");
  assert.equal(userId, SUBJECT, "req.userId is set to the token subject");
});

test("(b) NO azp (server-minted /api/live-token session) → MUST pass [the Safari fix]", async () => {
  const token = signSessionJwt({}); // no azp claim at all
  const { userId, res } = await runAuth(makeConfig(), token);
  assert.equal(res.status, null, "an azp-less token must NOT be rejected");
  assert.equal(userId, SUBJECT, "req.userId is set — this is exactly what 401'd before the fix");
});

test("(c) azp present but not in the allowlist → 401", async () => {
  const token = signSessionJwt({ azp: "https://evil.example.com" });
  const { userId, res } = await runAuth(makeConfig(), token);
  assert.equal(res.status, 401, "a wrong azp is rejected");
  assert.equal(userId, undefined, "req.userId is never set");
});

test("empty authorized-parties list → azp is not enforced (self-host default)", async () => {
  const token = signSessionJwt({ azp: "https://anything.example.com" });
  const { userId, res } = await runAuth(makeConfig({ authorizedParties: [] }), token);
  assert.equal(res.status, null, "no allowlist configured ⇒ origin check skipped");
  assert.equal(userId, SUBJECT);
});

test("allowlisted user id still enforced on top of the azp rule", async () => {
  const token = signSessionJwt({}); // no azp → passes origin check
  const { userId, res } = await runAuth(
    makeConfig({ allowedUserIds: ["user_someone_else"] }),
    token,
  );
  assert.equal(res.status, 403, "sub not on CLERK_ALLOWED_USER_IDS → 403");
  assert.equal(userId, undefined);
});

test("regression witness: the OLD code path (authorizedParties → verifyToken) 401s the azp-less token", async () => {
  const token = signSessionJwt({}); // no azp
  // Reproduce exactly what auth.ts used to do: hand the party list to verifyToken.
  await assert.rejects(
    () =>
      // NB: `issuer` is intentionally omitted — @clerk/backend v3.11 verifyToken
      // ignores it (its VerifyTokenOptions has no `issuer`), which is itself why
      // issuer pinning was ruled out as a cause. authorizedParties is the offender.
      verifyToken(token, {
        jwtKey: publicKey,
        authorizedParties: [ALLOWED_PARTY],
      }),
    (err: unknown) => {
      // @clerk/backend throws TokenVerificationError { reason: "token-invalid-authorized-parties" }
      const reason = (err as { reason?: string }).reason;
      assert.equal(reason, "token-invalid-authorized-parties");
      return true;
    },
    "the pre-fix path rejected server-minted (azp-less) tokens — the root cause",
  );

  // And the fix path (no authorizedParties) accepts the same token.
  const claims = await verifyToken(token, { jwtKey: publicKey });
  assert.equal(claims.sub, SUBJECT);
  assert.equal(claims.azp, undefined);
});
