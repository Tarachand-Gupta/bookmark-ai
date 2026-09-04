import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { EMPTY_REPLY_MESSAGE, emptyReplyMessage, emptyTurnGuard, isMeaningfulChunk } from "./chat-stream-guard";

async function run(chunks: UIMessageChunk[], getFinishReason?: () => Promise<string | undefined>): Promise<UIMessageChunk[]> {
  const source = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  const out: UIMessageChunk[] = [];
  const reader = source.pipeThrough(emptyTurnGuard(getFinishReason)).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

const start: UIMessageChunk = { type: "start", messageId: "a1" };
const finish = (finishReason?: string): UIMessageChunk =>
  ({ type: "finish", ...(finishReason ? { finishReason } : {}) }) as UIMessageChunk;

describe("emptyTurnGuard", () => {
  it("a start…finish turn with nothing in it gets a readable error chunk before finish", async () => {
    const out = await run([start, { type: "start-step" }, { type: "finish-step" }, finish("stop")]);
    expect(out.map((c) => c.type)).toEqual(["start", "start-step", "finish-step", "error", "finish"]);
    expect(out[3]).toEqual({ type: "error", errorText: EMPTY_REPLY_MESSAGE });
  });

  it("names a non-stop finish reason", async () => {
    const out = await run([start, finish("content-filter")]);
    expect(out[1]).toEqual({ type: "error", errorText: `${EMPTY_REPLY_MESSAGE} (finish reason: content-filter)` });
  });

  it("falls back to the result's finishReason when the finish chunk has none", async () => {
    const out = await run([start, finish()], async () => "length");
    expect((out[1] as { errorText: string }).errorText).toContain("(finish reason: length)");
    const quiet = await run([start, finish()], async () => {
      throw new Error("nope");
    });
    expect(quiet[1]).toEqual({ type: "error", errorText: EMPTY_REPLY_MESSAGE });
  });

  it("leaves turns with text, reasoning, tools or an explicit error untouched", async () => {
    const withText: UIMessageChunk[] = [start, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Hi" }, { type: "text-end", id: "t" }, finish("stop")];
    expect((await run(withText)).map((c) => c.type)).toEqual(withText.map((c) => c.type));
    const withTool: UIMessageChunk[] = [start, { type: "tool-input-start", toolCallId: "c1", toolName: "searchBookmarks" }, finish("tool-calls")];
    expect((await run(withTool)).map((c) => c.type)).toEqual(["start", "tool-input-start", "finish"]);
    const withReasoning: UIMessageChunk[] = [start, { type: "reasoning-delta", id: "r", delta: "thinking" }, finish("stop")];
    expect((await run(withReasoning)).map((c) => c.type)).toEqual(["start", "reasoning-delta", "finish"]);
    const withError: UIMessageChunk[] = [start, { type: "error", errorText: "provider said no" }, finish("error")];
    expect((await run(withError)).map((c) => c.type)).toEqual(["start", "error", "finish"]);
  });

  it("whitespace-only deltas do not count as content", async () => {
    const out = await run([start, { type: "text-delta", id: "t", delta: "   " }, { type: "reasoning-delta", id: "r", delta: "\n" }, finish("stop")]);
    expect(out.map((c) => c.type)).toEqual(["start", "text-delta", "reasoning-delta", "error", "finish"]);
  });
});

describe("helpers", () => {
  it("emptyReplyMessage / isMeaningfulChunk", () => {
    expect(emptyReplyMessage()).toBe(EMPTY_REPLY_MESSAGE);
    expect(emptyReplyMessage("stop")).toBe(EMPTY_REPLY_MESSAGE);
    expect(emptyReplyMessage("other")).toContain("(finish reason: other)");
    expect(isMeaningfulChunk({ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" })).toBe(true);
    expect(isMeaningfulChunk({ type: "start-step" })).toBe(false);
    expect(isMeaningfulChunk({ type: "text-delta", id: "t", delta: "" })).toBe(false);
  });
});
