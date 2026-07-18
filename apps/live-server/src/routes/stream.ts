import type { FastifyInstance } from "fastify";
import { sseCorsHeaders } from "../cors";
import type { Deps } from "../deps";
import { initSse, writeComment, writeEvent } from "../sse";

const KEEPALIVE_MS = 25_000;

/**
 * GET /live/stream — SSE. Sends a full `state` frame on connect and again on
 * every change for this user (delivered via Redis pub/sub, so any server instance
 * can serve any subscriber — horizontal scale with no sticky sessions). We re-read
 * and send the FULL list per event (not deltas): the payload is tiny and full-state
 * frames make reconnect self-healing (a viewer that missed events converges on
 * reconnect). A `:keepalive` comment every 25s keeps proxies from idling us out.
 */
export function registerStream(app: FastifyInstance, { store, config, auth }: Deps): void {
  app.get("/live/stream", { preHandler: auth }, async (req, reply) => {
    const userId = req.userId;
    const raw = initSse(reply, sseCorsHeaders(req.headers.origin, config.allowedOrigins));

    let closed = false;

    const sendState = async (): Promise<void> => {
      if (closed) return;
      try {
        const enabled = await store.getEnabled(userId);
        const devices = enabled ? await store.listDevices(userId) : [];
        writeEvent(raw, "state", { devices, enabled, ttlHours: config.ttlHours });
      } catch {
        // transient read error — the next event (or the client's reconnect) recovers
      }
    };

    await sendState();

    const unsubscribe = store.subscribe(userId, () => {
      void sendState();
    });

    const heartbeat = setInterval(() => {
      if (!closed) writeComment(raw, "keepalive");
    }, KEEPALIVE_MS);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      try {
        raw.end();
      } catch {
        // socket already gone
      }
    };

    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);
  });
}
