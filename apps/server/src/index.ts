import { createDb, ensureSchema } from "@bookmark-ai/db";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { GeminiClient } from "./services/gemini.js";
import { startEmbedWorker } from "./services/embeddings.js";

async function main() {
  const env = loadEnv();

  const db = createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
  await ensureSchema(db);

  const gemini = env.GEMINI_API_KEY ? new GeminiClient(env.GEMINI_API_KEY) : null;
  if (!gemini) {
    console.warn(
      "[server] GEMINI_API_KEY not set — using heuristic categorization and full-text-only search",
    );
  }

  const embedWorker = startEmbedWorker(gemini, db);
  const app = createApp({ db, gemini, onSaved: embedWorker.kick });

  const server = app.listen(env.PORT, () => {
    console.log(`[server] bookmark-ai API on http://localhost:${env.PORT}`);
    console.log(`[server] database: ${env.DATABASE_URL}`);
    console.log(`[server] ai: ${gemini ? "gemini" : "disabled"}`);
  });

  const shutdown = () => {
    embedWorker.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Last-resort guard: background work (embed sweeps) must never take the
// server down on a transient failure.
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason);
});

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
