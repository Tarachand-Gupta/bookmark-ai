import { updateLiveDeviceSettingsSchema, updateLiveSettingsSchema } from "@bookmark-ai/types";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * POST /live/settings — the account-wide opt-in flag (durable consent, now in
 * Redis). Turning it OFF purges every device in the same call (invariant), and
 * the purge publishes a `reset` so open SSE streams flip to the empty/off state.
 *
 * PATCH /live/:deviceId/settings — the per-device "new windows share by default"
 * policy. Off means windows opened on that device after the change don't auto-join
 * live sessions (the extension popup can still turn an individual window on). The
 * store persists it with no TTL and publishes a `push` so open viewers re-read.
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

  app.patch<{ Params: { deviceId: string } }>(
    "/live/:deviceId/settings",
    { preHandler: auth },
    async (req, reply) => {
      const parsed = updateLiveDeviceSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      }
      await store.setDeviceNewWindowsShared(
        req.userId,
        req.params.deviceId,
        parsed.data.newWindowsShared,
      );
      return reply.send({ ok: true });
    },
  );
}
