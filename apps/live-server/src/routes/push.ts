import { pushLiveStateSchema } from "@bookmark-ai/types";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * POST /live — one checkpoint push from a device. Byte-compatible with the old
 * Vercel route: 403 {ok,enabled:false} when the account flag is off (the extension
 * reads this to stop publishing), 429 when over the daily quota, else
 * 200 {ok:true,enabled:true}. Publishes so open SSE streams re-emit — but ONLY
 * when the write actually changed visible state (writeSnapshot reports it): a
 * heartbeat or a no-op push (identical windows/labels) refreshes liveness + TTL
 * without fanning a full-state re-read out to every connected viewer.
 */
export function registerPush(app: FastifyInstance, { store, auth }: Deps): void {
  app.post("/live", { preHandler: auth }, async (req, reply) => {
    const parsed = pushLiveStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }

    const userId = req.userId;
    if (!(await store.getEnabled(userId))) {
      return reply.code(403).send({ ok: false, enabled: false });
    }

    const dayUtc = new Date().toISOString().slice(0, 10);
    const underQuota = await store.checkAndBumpQuota(userId, parsed.data.deviceId, dayUtc);
    if (!underQuota) {
      return reply.code(429).send({ error: "Daily push limit reached for this device." });
    }

    const { changed, newWindowsShared } = await store.writeSnapshot(userId, parsed.data);
    if (changed) {
      await store.publish(userId, { type: "push", deviceId: parsed.data.deviceId });
    }
    // Echo the per-device new-window policy so the extension mirrors it off the
    // push it already sends (no extra request). Absent key ⇒ true.
    return reply.send({ ok: true, enabled: true, newWindowsShared });
  });
}
