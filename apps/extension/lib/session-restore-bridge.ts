import { validRestoreMessage } from "./session-restore";

// Mirrored in apps/web/lib/extension-bridge.ts; no credentials cross this channel.
export const RESTORE_PAGE_CHANNEL = "bookmark-ai-session-restore-v1";
export function connectSessionRestorePage(target: Window, send: (message: unknown) => Promise<unknown>): () => void {
  const handled = new Set<string>();
  const listener = (event: MessageEvent) => {
    if (event.source !== target || event.origin !== target.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== RESTORE_PAGE_CHANNEL || data.direction !== "request"
      || typeof data.id !== "string" || data.id.length > 100) return;
    if (data.message?.type !== "BOOKMARK_AI_PING" && !validRestoreMessage(data.message)) return;
    if (data.message.type === "RESTORE_SESSION") {
      if (handled.has(data.id)) return;
      if (handled.size >= 500) {
        target.postMessage({ channel: RESTORE_PAGE_CHANNEL, direction: "response", id: data.id, response: { ok: false, reason: "failed" } }, target.location.origin);
        return;
      }
      handled.add(data.id); // Never open a second window for a replayed request.
    }
    void Promise.resolve().then(() => send(data.message)).then(
      response => target.postMessage({ channel: RESTORE_PAGE_CHANNEL, direction: "response", id: data.id, response }, target.location.origin),
      () => target.postMessage({ channel: RESTORE_PAGE_CHANNEL, direction: "response", id: data.id, response: { ok: false, reason: "failed" } }, target.location.origin),
    );
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
