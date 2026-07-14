import { createDb, ensureSchema, type Db } from "@bookmark-ai/db";
import { GeminiClient } from "@bookmark-ai/engine";

export interface ApiContext {
  db: Db;
  gemini: GeminiClient | null;
  /** Resolves once the schema has been ensured (runs once per process). */
  ready: Promise<void>;
}

// One context per process: survives dev HMR and is shared across route
// modules within a warm serverless instance.
const store = globalThis as unknown as { __bookmarkApiContext?: ApiContext };

export function getApiContext(): ApiContext {
  if (!store.__bookmarkApiContext) {
    const db = createDb(
      // Fallback shares the Express server's local file DB for fully-local
      // setups; deployed instances always set DATABASE_URL.
      process.env.DATABASE_URL ?? "file:../server/data/bookmarks.db",
      process.env.DATABASE_AUTH_TOKEN,
    );
    const gemini = process.env.GEMINI_API_KEY
      ? new GeminiClient(process.env.GEMINI_API_KEY)
      : null;
    store.__bookmarkApiContext = {
      db,
      gemini,
      // A transient schema-check failure must not brick every request in
      // this instance — log it and let the first real query fail loudly.
      ready: ensureSchema(db).catch((err: unknown) => {
        console.error("[api] ensureSchema failed:", err);
      }),
    };
  }
  return store.__bookmarkApiContext;
}
