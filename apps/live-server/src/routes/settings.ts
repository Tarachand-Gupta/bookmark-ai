import { updateLiveDeviceSettingsSchema, updateLiveSettingsSchema } from "@bookmark-ai/types";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * POST /live/settings — first-party account-wide opt-in; OFF purges all devices.
 * Verified extensions use their existing request as their own publishing switch:
 * OFF atomically stops/deletes only that session, ON re-arms it and account opt-in.
 * Device preferences remain independent of stopping publication.
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
    if (req.liveAuthSession?.isExtension) {
      // Existing extension packages use this endpoint for their local switch.
      // Ownership comes from verified auth, not a body/device label.
      await store.setExtensionPublishing(req.userId, req.liveAuthSession.sessionId, parsed.data.enabled);
    } else {
      await store.setEnabled(req.userId, parsed.data.enabled);
      if (!parsed.data.enabled) await store.deleteAllDevices(req.userId);
    }
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
