import type { FastifyInstance } from "fastify";
import { sseCorsHeaders } from "../cors";
import type { Deps } from "../deps";
import { initSse, writeComment, writeEvent } from "../sse";

const KEEPALIVE_MS = 25_000;

/**
 * SECURITY: cap concurrent SSE streams per user so one account can't pin open an
 * unbounded number of long-lived connections (each holds a socket + a Redis
 * subscription). In-memory per instance — coarse across horizontally-scaled
 * instances, but enough to stop a single client from opening hundreds. The
 * counter is decremented in the connection's `cleanup`, which runs exactly once.
 */
const MAX_STREAMS_PER_USER = 8;
const streamCounts = new Map<string, number>();

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

    // Reject (before hijacking the response for SSE) once this user is at the cap.
    const active = streamCounts.get(userId) ?? 0;
    if (active >= MAX_STREAMS_PER_USER) {
      return reply.code(429).send({ error: "Too many concurrent live streams" });
    }
    streamCounts.set(userId, active + 1);

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
      // Release this user's slot. Runs exactly once (guarded by `closed`).
      const remaining = (streamCounts.get(userId) ?? 1) - 1;
      if (remaining <= 0) streamCounts.delete(userId);
      else streamCounts.set(userId, remaining);
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
