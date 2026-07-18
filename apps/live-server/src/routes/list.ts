import { listLiveResponseSchema } from "@bookmark-ai/types";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * GET /live — the non-SSE reader (initial load + fallback, parity with the old
 * `getLive`). Off returns no devices regardless of stored state; the outgoing
 * payload is validated with the shared schema as a cheap correctness guard.
 */
export function registerList(app: FastifyInstance, { store, config, auth }: Deps): void {
  app.get("/live", { preHandler: auth }, async (req, reply) => {
    const userId = req.userId;
    if (!(await store.getEnabled(userId))) {
      return reply.send({ devices: [], enabled: false, ttlHours: config.ttlHours });
    }
    const devices = await store.listDevices(userId);
    return reply.send(
      listLiveResponseSchema.parse({ devices, enabled: true, ttlHours: config.ttlHours }),
    );
  });
}
