import { verifyToken } from "@clerk/backend";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type Config, LOCAL_USER } from "./config";
import { DEVICE_TOKEN_PREFIX, verifyDeviceToken } from "./device-token";

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
export function makeAuthPreHandler(config: Config) {
  const openMode = config.devOpen || (!config.clerkSecretKey && !config.clerkJwtKey);

  return async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
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

    // Long-lived device token (Safari extension header-auth) — a self-contained
    // HS256 JWT we verify locally, minted by the web app (apps/web/lib/server/
    // device-token.ts). No azp, so it skips the origin check; same allowlist.
    if (token.startsWith(DEVICE_TOKEN_PREFIX)) {
      const verified = verifyDeviceToken(token, config.deviceTokenSecret);
      if (!verified) {
        await reply.code(401).send({ error: "Invalid or expired token" });
        return;
      }
      if (
        config.allowedUserIds.length > 0 &&
        !config.allowedUserIds.includes(verified.userId)
      ) {
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
