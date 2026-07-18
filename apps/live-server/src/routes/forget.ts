import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps";

/**
 * DELETE /live/:deviceId — forget one device (idempotent, 204).
 * DELETE /live — forget all (204). A PURE purge: it does NOT flip the account
 * flag, so devices reappear on their next check-in ("Forget", not "Stop").
 */
export function registerForget(app: FastifyInstance, { store, auth }: Deps): void {
  app.delete<{ Params: { deviceId: string } }>(
    "/live/:deviceId",
    { preHandler: auth },
    async (req, reply) => {
      await store.deleteDevice(req.userId, req.params.deviceId);
      return reply.code(204).send();
    },
  );

  app.delete("/live", { preHandler: auth }, async (req, reply) => {
    await store.deleteAllDevices(req.userId);
    return reply.code(204).send();
  });
}
