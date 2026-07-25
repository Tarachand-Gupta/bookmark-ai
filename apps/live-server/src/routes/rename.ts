import { renameLiveWindowSchema } from "@bookmark-ai/types";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * PATCH /live/:deviceId/windows/:windowId — set (or clear) the viewer's display
 * name for ONE window of a live device. Body `{ name }`; an empty string clears
 * the override (restores the default "Window N"). The override lives server-side
 * (Redis), so it survives pushes and is overlaid onto list/stream responses.
 * `windowId` is a string in the URL, stored verbatim to match the pushed windows'
 * windowId serialization. Device labels are NOT renamable here — windows only.
 */
export function registerRename(app: FastifyInstance, { store, auth }: Deps): void {
  app.patch<{ Params: { deviceId: string; windowId: string } }>(
    "/live/:deviceId/windows/:windowId",
    { preHandler: auth },
    async (req, reply) => {
      const parsed = renameLiveWindowSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      }
      await store.setWindowName(
        req.userId,
        req.params.deviceId,
        req.params.windowId,
        parsed.data.name,
      );
      return reply.send({ ok: true });
    },
  );
}
