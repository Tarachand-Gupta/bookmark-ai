import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { Db } from "@bookmark-ai/db";
import { corsOriginCheck, createAuthMiddleware, type AuthConfig } from "./auth.js";
import { HttpError } from "./lib/http-error.js";
import { bookmarksRouter } from "./routes/bookmarks.js";
import { searchRouter } from "./routes/search.js";
import { metaRouter } from "./routes/meta.js";
import { sessionsRouter } from "./routes/sessions.js";
import type { GeminiClient } from "./services/gemini.js";

export interface AppDeps {
  db: Db;
  gemini: GeminiClient | null;
  /** Called after each save so the embed worker can pick it up immediately. */
  onSaved: () => void;
  /** Clerk JWT verification; jwtKey unset = open local mode (see auth.ts). */
  auth: AuthConfig;
}

export function createApp({ db, gemini, onSaved, auth }: AppDeps): Express {
  const app = express();

  // Local mode stays permissive (desktop, any extension origin, curl). With
  // auth enforced, browsers are restricted to the known origins — extension
  // schemes and Origin-less native clients pass CORS but still need a token.
  app.use(cors(auth.jwtKey ? { origin: corsOriginCheck(auth.authorizedParties) } : {}));
  // Render terminates TLS at a proxy — trust one hop so rate limiting sees
  // the real client IP instead of the proxy's.
  app.set("trust proxy", 1);
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120, // generous: the web app fires several requests per interaction
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === "/api/health" || req.method === "OPTIONS",
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(createAuthMiddleware(auth));

  app.use("/api/bookmarks", bookmarksRouter(db, gemini, onSaved));
  app.use("/api/search", searchRouter(db, gemini));
  app.use("/api/sessions", sessionsRouter(db));
  app.use("/api", metaRouter(db, gemini !== null));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("[server] unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
