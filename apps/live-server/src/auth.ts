import { extensionLiveRequestAllowed } from "./extension-policy";
import {
  withAuthDeadline,
  createSupabaseVerifier,
  InvalidSessionError,
  classifyOAuthClient,
} from "@bookmark-ai/engine";
import { connectPostgres } from "@bookmark-ai/db";
import { verifyToken } from "@clerk/backend";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type Config, LOCAL_USER } from "./config";
import { DEVICE_TOKEN_PREFIX, verifyDeviceToken } from "./device-token";

/** Bounded abuse counters, never authentication approval or token storage. */
const limits = new Map<string, { start: number; count: number }>();
class MfaRequiredError extends Error {}
class CapabilityDeniedError extends Error {}
function allowRequest(key: string, max: number) {
  const now = Date.now();
  let bucket = limits.get(key);
  if (!bucket || now - bucket.start >= 60000) {
    bucket = { start: now, count: 0 };
    limits.set(key, bucket);
  }
  if (limits.size > 10000) limits.delete(limits.keys().next().value!);
  return ++bucket.count <= max;
}

/**
 * Clerk session-JWT verification as a Fastify preHandler, OFFLINE — the same
 * `Authorization: Bearer <jwt>` all three clients already send. Mirrors the web
 * app's `require-user.ts`:
 *  - `authorizedParties` (azp) check with Express semantics — absent azp passes
 *    (native mobile minted tokens), a wrong azp rejects;
 *  - the `CLERK_ALLOWED_USER_IDS` allowlist → 403;
 *  - `userId = claims.sub` becomes the Redis namespace.
 * `verifyToken` caches the JWKS after first fetch (networkless thereafter); pass
 * `CLERK_JWT_KEY` + `CLERK_ISSUER` for a fully egress-free VM.
 *
 * Open/dev mode (no Clerk keys, or DEV_OPEN_API=1 outside production) short-circuits
 * to the "local" namespace so curl / the desktop client can smoke-test.
 */
export function makeAuthPreHandler(config: Config, dependencies: {
  verify?: ReturnType<typeof createSupabaseVerifier>;
  master?: Pick<ReturnType<typeof connectPostgres>, "query">;
} = {}) {
  const supabase = config.authProvider === "supabase";
  const openMode = !supabase && (config.devOpen || (!config.clerkSecretKey && !config.clerkJwtKey));
  const verifier = supabase
    ? dependencies.verify ?? createSupabaseVerifier({
        url: config.supabaseUrl ?? "",
        publishableKey: config.supabasePublishableKey ?? "",
      })
    : null;
  const master =
    supabase && config.supabaseDatabaseUrl
      ? dependencies.master ?? connectPostgres(config.supabaseDatabaseUrl, { caBase64: config.supabaseDatabaseCaBase64 })
      : null;

  return async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (supabase && !allowRequest(`ip:${req.ip}`, 240)) {
      await reply.code(429).send({ error: "Too many requests" });
      return;
    }
    if (openMode) {
      req.userId = LOCAL_USER;
      return;
    }

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      await reply.code(401).send({ error: "Missing or invalid bearer token" });
      return;
    }

    if (supabase) {
      try {
        if (!verifier || !master) throw new Error();
        const check = () => withAuthDeadline(async () => {
          const identity = await verifier(token);
          const capability = classifyOAuthClient(
            identity.clientId,
            config.supabaseExtensionClientIds ?? [],
          );
          if (capability === "denied") throw new InvalidSessionError("Invalid client");
          if (
            capability === "extension" &&
            !extensionLiveRequestAllowed(req.method, req.url, identity.sessionId, req.body)
          )
            throw new CapabilityDeniedError();
          if (
            identity.user.factors?.some((f) => f.status === "verified") &&
            identity.aal !== "aal2"
          )
            throw new MfaRequiredError();
          const accounts = await master.query(
            "select a.id from bmai_qa.identities i join bmai_qa.accounts a on a.id=i.account_id where i.provider='supabase' and i.subject=$1 and a.state='active'",
            [identity.providerUserId],
          );
          if (!accounts[0]) throw new InvalidSessionError("Account unavailable");
          return { userId: String(accounts[0].id), sessionId: identity.sessionId, isExtension: capability === "extension" };
        });
        const approved = await check();
        req.userId = approved.userId;
        req.liveAuthSession = { sessionId: approved.sessionId, isExtension: approved.isExtension };
        if (!allowRequest(`account:${req.userId}`, 240)) {
          await reply.code(429).send({ error: "Too many requests" });
          return;
        }
        (req as any).revalidateSession = async () => (await check()).userId === req.userId;
        return;
      } catch (error) {
        await reply
          .code(
            error instanceof CapabilityDeniedError
              ? 403
              : error instanceof MfaRequiredError
                ? 403
                : error instanceof InvalidSessionError
                  ? 401
                  : 503,
          )
          .send({
            error:
              error instanceof CapabilityDeniedError
                ? "This token may not access this endpoint"
                : error instanceof MfaRequiredError
                  ? "Complete two-factor verification"
                  : error instanceof InvalidSessionError
                    ? "Invalid session"
                    : "Authentication temporarily unavailable",
          });
        return;
      }
    }

    // Long-lived device token (Safari extension header-auth) — a self-contained
    // HS256 JWT we verify locally, minted by the web app (apps/web/lib/server/
    // device-token.ts). No azp, so it skips the origin check; same allowlist.
    if (token.startsWith(DEVICE_TOKEN_PREFIX)) {
      const verified = verifyDeviceToken(token, config.deviceTokenSecret);
      if (!verified) {
        await reply.code(401).send({ error: "Invalid or expired token" });
        return;
      }
      if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(verified.userId)) {
        await reply.code(403).send({ error: "This account may not use this API" });
        return;
      }
      req.userId = verified.userId;
      return;
    }

    let claims: { sub?: string; azp?: string };
    try {
      // NB: do NOT pass `authorizedParties` into verifyToken. @clerk/backend's
      // assertAuthorizedPartiesClaim REJECTS a token whose azp is ABSENT once a
      // non-empty list is supplied (jwt/index.js: `if (!azp ||
      // !authorizedParties.includes(azp))` throws) — the OPPOSITE of the semantics
      // we (and apps/web require-user.ts) want. Server-minted session tokens
      // (clerkClient sessions.getToken, used by the /api/live-token bridge for the
      // Safari extension) carry NO azp, so passing the list here 401s them. We
      // verify signature/exp here, then apply the azp origin rule ourselves below.
      claims = await verifyToken(token, {
        ...(config.clerkJwtKey
          ? { jwtKey: config.clerkJwtKey }
          : { secretKey: config.clerkSecretKey as string }),
        ...(config.clerkIssuer ? { issuer: config.clerkIssuer } : {}),
      });
    } catch {
      await reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    // azp origin check with Express semantics (mirrors apps/web require-user.ts):
    // ABSENT azp passes (server-minted + native mobile tokens), a PRESENT azp must
    // be an authorized party. Only enforced when a party allowlist is configured —
    // an empty CLERK_AUTHORIZED_PARTIES means "don't check origin" (self-host default).
    const azp = claims.azp;
    if (azp && config.authorizedParties.length > 0 && !config.authorizedParties.includes(azp)) {
      await reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    const userId = claims.sub;
    if (!userId) {
      await reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      await reply.code(403).send({ error: "This account may not use this API" });
      return;
    }
    req.userId = userId;
  };
}
