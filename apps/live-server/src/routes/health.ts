import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/** Liveness for the compose healthcheck and the Caddy upstream — no auth. */
export function registerHealth(app: FastifyInstance, { store }: Deps): void {
  app.get("/health", async (_req, reply) => {
    const ok = await store.ping();
    return reply.code(ok ? 200 : 503).send({ ok });
  });
}
