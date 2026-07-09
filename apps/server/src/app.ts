import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { Db } from "@bookmark-ai/db";
import { HttpError } from "./lib/http-error.js";
import { bookmarksRouter } from "./routes/bookmarks.js";
import { searchRouter } from "./routes/search.js";
import { metaRouter } from "./routes/meta.js";
import type { GeminiClient } from "./services/gemini.js";

export interface AppDeps {
  db: Db;
  gemini: GeminiClient | null;
  /** Called after each save so the embed worker can pick it up immediately. */
  onSaved: () => void;
}

export function createApp({ db, gemini, onSaved }: AppDeps): Express {
  const app = express();

  // Extension content lives on arbitrary origins (moz-extension://,
  // chrome-extension://, web app, desktop) — this is a local-first API.
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/bookmarks", bookmarksRouter(db, gemini, onSaved));
  app.use("/api/search", searchRouter(db, gemini));
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
