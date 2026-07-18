import { updateLiveSettingsSchema } from "@bookmark-ai/types";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * POST /live/settings — the account-wide opt-in flag (durable consent, now in
 * Redis). Turning it OFF purges every device in the same call (invariant), and
 * the purge publishes a `reset` so open SSE streams flip to the empty/off state.
 */
export function registerSettings(app: FastifyInstance, { store, auth }: Deps): void {
  app.post("/live/settings", { preHandler: auth }, async (req, reply) => {
    const parsed = updateLiveSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    await store.setEnabled(req.userId, parsed.data.enabled);
    if (!parsed.data.enabled) await store.deleteAllDevices(req.userId);
    return reply.send({ enabled: parsed.data.enabled });
  });
}
