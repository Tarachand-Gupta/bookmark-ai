import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { type Config, loadConfig } from "./config";
import type { Deps } from "./deps";
import { makeAuthPreHandler } from "./auth";
import { LiveFanout } from "./fanout";
import { LiveStore } from "./live-store";
import { createRedis, type RedisBundle } from "./redis";
import { registerForget } from "./routes/forget";
import { registerHealth } from "./routes/health";
import { registerList } from "./routes/list";
import { registerPush } from "./routes/push";
import { registerRename } from "./routes/rename";
import { registerSettings } from "./routes/settings";
import { registerStream } from "./routes/stream";
import "./types";

/**
 * Build the Fastify app. Exported (separate from `main`) so a test could boot it
 * against a throwaway Redis. `main` only runs when this file is the entrypoint.
 */
export async function buildServer(
  config: Config = loadConfig(),
  redis: RedisBundle = createRedis(config.redisUrl),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000, trustProxy: true });
  const store = new LiveStore(redis, config);
  const fanout = new LiveFanout(store, {
    coalesceMs: config.fanoutCoalesceMs,
    refreshEmitMs: config.refreshEmitMs,
    ttlHours: config.ttlHours,
  });

  await app.register(cors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: false,
  });

  const deps: Deps = { store, config, auth: makeAuthPreHandler(config), fanout };
  registerHealth(app, deps);
  registerPush(app, deps);
  registerList(app, deps);
  registerStream(app, deps);
  registerForget(app, deps);
  registerRename(app, deps);
  registerSettings(app, deps);

  app.addHook("onClose", async () => {
    fanout.closeAll();
    await redis.close();
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  const shutdown = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    // Bound to loopback because Caddy reverse-proxies from 127.0.0.1 (see
    // deploy/Caddyfile.snippet); avoids relying on the host firewall for the app port.
    await app.listen({ host: "127.0.0.1", port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const isEntry =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;
if (isEntry) {
  void main();
}
