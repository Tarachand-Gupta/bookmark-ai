import "fastify";

/** The pub/sub envelope published on every mutation so SSE streams re-emit.
 * Deliberately tiny — the stream handler re-reads full state on any event
 * (v1 sends full-state frames, not deltas), so the envelope only needs to say
 * "something changed" (and which device, for a possible future delta path). */
export type LiveEvent =
  | { type: "push"; deviceId: string }
  | { type: "delete"; deviceId: string }
  | { type: "reset" };

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth preHandler. The Redis namespace for this request.
     * In open/dev mode it is the "local" sentinel, never a real Clerk id. */
    userId: string;
  }
}
