import type { ServerResponse } from "node:http";
import type { FastifyReply } from "fastify";

/**
 * Server-Sent Events over a hijacked Fastify reply. We take over the raw socket
 * (`reply.hijack()`) so Fastify never tries to serialize a body, then write the
 * event-stream headers ourselves. `X-Accel-Buffering: no` + `no-transform` tell
 * proxies (nginx) not to buffer; Caddy streams by default but we also set
 * `flush_interval -1` on its side. CORS must be written here — the hijack skips
 * the @fastify/cors onSend hook.
 */
export function initSse(reply: FastifyReply, corsHeaders: Record<string, string>): ServerResponse {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...corsHeaders,
  });
  // Flush headers immediately so the client's onopen fires without waiting.
  raw.write(":ok\n\n");
  return raw;
}

/** Serialize an SSE event to its wire frame WITHOUT writing it. The fan-out path
 * serializes once here and writes the resulting string to every subscriber's
 * socket (one JSON.stringify for N clients). */
export function formatEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Write a pre-serialized frame (from `formatEvent`) to one socket. */
export function writeFrame(raw: ServerResponse, frame: string): void {
  raw.write(frame);
}

export function writeEvent(raw: ServerResponse, event: string, data: unknown): void {
  raw.write(formatEvent(event, data));
}

/** A comment line — invisible to EventSource, keeps proxies from idling the connection out. */
export function writeComment(raw: ServerResponse, text: string): void {
  raw.write(`: ${text}\n\n`);
}
