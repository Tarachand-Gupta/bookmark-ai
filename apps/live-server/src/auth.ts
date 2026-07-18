import { verifyToken } from "@clerk/backend";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type Config, LOCAL_USER } from "./config";

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

    let claims: { sub?: string };
    try {
      claims = await verifyToken(token, {
        ...(config.clerkJwtKey
          ? { jwtKey: config.clerkJwtKey }
          : { secretKey: config.clerkSecretKey as string }),
        ...(config.clerkIssuer ? { issuer: config.clerkIssuer } : {}),
        ...(config.authorizedParties.length
          ? { authorizedParties: config.authorizedParties }
          : {}),
      });
    } catch {
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
