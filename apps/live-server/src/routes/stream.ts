import type { FastifyInstance } from "fastify";
import { sseCorsHeaders } from "../cors";
import type { Deps } from "../deps";
import { initSse, writeComment, writeEvent, writeFrame } from "../sse";

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
 * GET /live/stream — SSE. Sends a full `state` frame IMMEDIATELY on connect (so
 * connection UX never waits on the coalesce window), then joins the per-user
 * `LiveFanout` group for all subsequent updates: pub/sub-triggered changes are
 * coalesced (one read + one serialize broadcast to every viewer) and a viewer-gated
 * periodic tick keeps idle devices' "last seen" age fresh. Full-state frames make
 * reconnect self-healing (a viewer that missed events converges on reconnect). A
 * `:keepalive` comment every 25s keeps proxies from idling us out.
 */
export function registerStream(app: FastifyInstance, { store, config, auth, fanout }: Deps): void {
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

    // Immediate initial frame for THIS connection — never routed through the
    // coalesce window, so a new viewer sees state at once.
    try {
      const enabled = await store.getEnabled(userId);
      const devices = enabled ? await store.listDevices(userId) : [];
      writeEvent(raw, "state", { devices, enabled, ttlHours: config.ttlHours });
    } catch {
      // transient read error — the fanout group's next frame (or reconnect) recovers
    }

    // Subsequent updates arrive as pre-serialized frames from the shared per-user group.
    const leave = fanout.join(userId, (frame) => {
      if (!closed) writeFrame(raw, frame);
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
      leave();
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
