import { createDb, ensureSchema } from "@bookmark-ai/db";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { DEFAULT_AUTHORIZED_PARTIES } from "./auth.js";
import { GeminiClient } from "./services/gemini.js";
import { startEmbedWorker } from "./services/embeddings.js";

function splitCsv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

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

  const authorizedParties = splitCsv(env.CLERK_AUTHORIZED_PARTIES);
  const embedWorker = startEmbedWorker(gemini, db);
  const app = createApp({
    db,
    gemini,
    onSaved: embedWorker.kick,
    auth: {
      jwtKey: env.CLERK_JWT_KEY,
      authorizedParties: authorizedParties.length > 0 ? authorizedParties : DEFAULT_AUTHORIZED_PARTIES,
      allowedUserIds: new Set(splitCsv(env.CLERK_ALLOWED_USER_IDS)),
    },
  });

  const server = app.listen(env.PORT, () => {
    console.log(`[server] bookmark-ai API on http://localhost:${env.PORT}`);
    console.log(`[server] database: ${env.DATABASE_URL}`);
    console.log(`[server] ai: ${gemini ? "gemini" : "disabled"}`);
    console.log(`[server] auth: ${env.CLERK_JWT_KEY ? "clerk (enforced)" : "OPEN (local mode)"}`);
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
