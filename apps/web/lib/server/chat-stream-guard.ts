import type { UIMessageChunk } from "ai";

/**
 * Last line of defence for a turn that ENDS WITH NOTHING: the provider answered
 * 200 with no text, no reasoning, no tool call and threw no error (a safety /
 * recitation stop, an exhausted output budget, an input the model silently
 * refused). Without this the client receives `start … finish` and drops the
 * turn silently. The guard sits between `toUIMessageStream()` and the response:
 * it watches the chunks and, if the `finish` arrives with nothing meaningful
 * seen, writes an `error` chunk first so the user gets a readable failure. The
 * persisted-turn decision is separate (see the route's onEnd) and unaffected.
 */

export const EMPTY_REPLY_MESSAGE = "The AI returned no reply. Try again, or start a new conversation.";

export function emptyReplyMessage(finishReason?: string | null): string {
  return finishReason && finishReason !== "stop"
    ? `${EMPTY_REPLY_MESSAGE} (finish reason: ${finishReason})`
    : EMPTY_REPLY_MESSAGE;
}

/** Chunks that put something in front of the user (or already explain a failure). */
export function isMeaningfulChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return typeof chunk.delta === "string" && chunk.delta.trim() !== "";
    case "tool-input-start":
    case "tool-input-available":
    case "tool-output-available":
    case "tool-output-error":
    case "file":
    case "source-url":
    case "source-document":
    case "error":
    case "abort":
      return true;
    default:
      return false;
  }
}

/**
 * TransformStream that injects an `error` chunk before a `finish` when the turn
 * carried nothing meaningful. `getFinishReason` (e.g. `() => result.finishReason`)
 * is consulted only when the finish chunk itself carries no reason.
 */
export function emptyTurnGuard(
  getFinishReason?: () => PromiseLike<string | undefined>,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  let meaningful = false;
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    async transform(chunk, controller) {
      if (!meaningful && isMeaningfulChunk(chunk)) meaningful = true;
      if (chunk.type === "finish" && !meaningful) {
        let reason: string | undefined = chunk.finishReason;
        if (!reason && getFinishReason) {
          reason = await Promise.resolve()
            .then(() => getFinishReason())
            .catch(() => undefined);
        }
        controller.enqueue({ type: "error", errorText: emptyReplyMessage(reason) });
      }
      controller.enqueue(chunk);
    },
  });
}
