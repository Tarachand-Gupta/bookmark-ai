import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "@clerk/backend";

/** Origins allowed to hold a session for this API: the web app (local + prod)
 * and the extension (pinned CRX id). Doubles as the token `azp` allowlist and
 * the CORS allowlist. Override via CLERK_AUTHORIZED_PARTIES. */
export const DEFAULT_AUTHORIZED_PARTIES = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://bookmark-ai-theta.vercel.app",
  "https://bookmark-ai.cloud",
  "https://www.bookmark-ai.cloud",
  "chrome-extension://ffhbgpgebpmofjkehpjcemepbgcmoelp",
];

export interface AuthConfig {
  /** Clerk instance PEM public key. Set → auth enforced; unset → open local mode. */
  jwtKey?: string;
  /** Allowed `azp` claims (browser origin the token was minted on). */
  authorizedParties: string[];
  /** When non-empty, only these Clerk user ids pass (single-user library). */
  allowedUserIds: Set<string>;
}

/**
 * Bearer-token auth for every /api route except /api/health. Verification is
 * networkless: the JWT is checked against the instance's public key, so the
 * Clerk secret key never touches this server. Without a key the API runs
 * open for fully-local setups (desktop app, import script, curl playbooks) —
 * never expose that mode publicly.
 */
export function createAuthMiddleware(config: AuthConfig) {
  if (!config.jwtKey) {
    console.warn(
      "[auth] CLERK_JWT_KEY not set — the API accepts UNAUTHENTICATED requests (local mode).",
    );
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  // Env vars often carry PEMs with literal \n; verifyToken needs real newlines.
  const jwtKey = config.jwtKey.replace(/\\n/g, "\n");

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS" || req.path === "/api/health") {
      next();
      return;
    }
    const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    if (!token) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    verifyToken(token, {
      jwtKey,
      ...(config.authorizedParties.length > 0
        ? { authorizedParties: config.authorizedParties }
        : {}),
    })
      .then((payload) => {
        if (config.allowedUserIds.size > 0 && !config.allowedUserIds.has(payload.sub)) {
          res.status(403).json({ error: "This account may not use this API" });
          return;
        }
        next();
      })
      .catch(() => {
        res.status(401).json({ error: "Invalid or expired token" });
      });
  };
}

/** CORS origin check for auth-enforced mode: known web origins, any browser
 * extension scheme (Firefox ids are per-install UUIDs, so no pinning — the
 * bearer token is the real gate), and Origin-less native clients. */
export function corsOriginCheck(allowed: string[]) {
  const allowedSet = new Set(allowed);
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    const ok =
      !origin || allowedSet.has(origin) || /^(chrome|moz|safari-web)-extension:\/\//.test(origin);
    callback(null, ok);
  };
}
