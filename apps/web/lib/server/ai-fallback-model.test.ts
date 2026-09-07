import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { withModelFallback } from "./ai-fallback-model";

type Part = { type: string; [k: string]: unknown };

/** A minimal spec-v4-shaped model whose stream is whatever we hand it. */
function fakeModel(
  name: string,
  make: () => { stream: ReadableStream<Part> } | Promise<{ stream: ReadableStream<Part> }>,
  generate: () => unknown = () => ({ from: name }),
): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: name,
    modelId: `${name}-model`,
    supportedUrls: {},
    doGenerate: async () => generate(),
    doStream: async () => make(),
  } as unknown as LanguageModel;
}

function streamOf(parts: Part[], { delayMs = 0 }: { delayMs?: number } = {}): ReadableStream<Part> {
  return new ReadableStream<Part>({
    async start(controller) {
      for (const p of parts) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(p);
      }
      controller.close();
    },
  });
}

async function drain(model: LanguageModel): Promise<Part[]> {
  const { stream } = await (model as unknown as {
    doStream(o: unknown): Promise<{ stream: ReadableStream<Part> }>;
  }).doStream({});
  const out: Part[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out.push(value);
  }
  return out;
}

const text = (id: string): Part[] => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id },
  { type: "text-delta", id, delta: `hello from ${id}` },
  { type: "text-end", id },
  { type: "finish" },
];

describe("withModelFallback — doStream", () => {
  it("passes the primary's stream through untouched, including the buffered head", async () => {
    const onDecision = vi.fn();
    const onFallback = vi.fn();
    const m = withModelFallback(
      fakeModel("primary", () => ({ stream: streamOf(text("p")) })),
      fakeModel("fallback", () => ({ stream: streamOf(text("f")) })),
      { onDecision, onFallback },
    );
    const parts = await drain(m);
    expect(parts.map((p) => p.type)).toEqual(["stream-start", "text-start", "text-delta", "text-end", "finish"]);
    expect(parts.find((p) => p.type === "text-delta")?.delta).toBe("hello from p");
    expect(onDecision).toHaveBeenCalledWith("primary");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back when the primary throws on doStream", async () => {
    const onFallback = vi.fn();
    const onDecision = vi.fn();
    const m = withModelFallback(
      fakeModel("primary", () => {
        throw new Error("OpenRouter 401");
      }),
      fakeModel("fallback", () => ({ stream: streamOf(text("f")) })),
      { onFallback, onDecision },
    );
    const parts = await drain(m);
    expect(parts.find((p) => p.type === "text-delta")?.delta).toBe("hello from f");
    expect(onFallback).toHaveBeenCalledWith("OpenRouter 401");
    expect(onDecision).toHaveBeenCalledWith("fallback");
  });

  it("falls back when the primary's FIRST part is an error", async () => {
    const onFallback = vi.fn();
    const m = withModelFallback(
      fakeModel("primary", () => ({
        stream: streamOf([{ type: "stream-start", warnings: [] }, { type: "error", error: new Error("rate limited") }]),
      })),
      fakeModel("fallback", () => ({ stream: streamOf(text("f")) })),
      { onFallback },
    );
    const parts = await drain(m);
    expect(parts.find((p) => p.type === "text-delta")?.delta).toBe("hello from f");
    expect(parts.some((p) => p.type === "error")).toBe(false);
    expect(onFallback).toHaveBeenCalledWith("rate limited");
  });

  it("falls back when the primary says nothing before the first-chunk timeout", async () => {
    const onFallback = vi.fn();
    const m = withModelFallback(
      fakeModel("primary", () => ({ stream: streamOf(text("p"), { delayMs: 200 }) })),
      fakeModel("fallback", () => ({ stream: streamOf(text("f")) })),
      { firstChunkTimeoutMs: 20, onFallback },
    );
    const parts = await drain(m);
    expect(parts.find((p) => p.type === "text-delta")?.delta).toBe("hello from f");
    expect(onFallback.mock.calls[0][0]).toMatch(/produced nothing/);
  });

  it("stays on the primary once real content has flowed (a LATER error is not retried)", async () => {
    const onFallback = vi.fn();
    const m = withModelFallback(
      fakeModel("primary", () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "p" },
          { type: "text-delta", id: "p", delta: "partial" },
          { type: "error", error: new Error("died mid-stream") },
        ]),
      })),
      fakeModel("fallback", () => ({ stream: streamOf(text("f")) })),
      { onFallback },
    );
    const parts = await drain(m);
    expect(parts.some((p) => p.type === "error")).toBe(true);
    expect(parts.find((p) => p.type === "text-delta")?.delta).toBe("partial");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("reports the primary's identity, not the fallback's", () => {
    const m = withModelFallback(
      fakeModel("primary", () => ({ stream: streamOf(text("p")) })),
      fakeModel("fallback", () => ({ stream: streamOf(text("f")) })),
    ) as unknown as { provider: string; modelId: string; specificationVersion: string };
    expect(m.provider).toBe("primary");
    expect(m.modelId).toBe("primary-model");
    expect(m.specificationVersion).toBe("v4");
  });
});

describe("withModelFallback — doGenerate", () => {
  it("uses the primary, and the fallback when it throws", async () => {
    const ok = withModelFallback(
      fakeModel("primary", () => ({ stream: streamOf([]) })),
      fakeModel("fallback", () => ({ stream: streamOf([]) })),
    ) as unknown as { doGenerate(o: unknown): Promise<{ from: string }> };
    expect(await ok.doGenerate({})).toEqual({ from: "primary" });

    const onFallback = vi.fn();
    const broken = withModelFallback(
      fakeModel(
        "primary",
        () => ({ stream: streamOf([]) }),
        () => {
          throw new Error("boom");
        },
      ),
      fakeModel("fallback", () => ({ stream: streamOf([]) })),
      { onFallback },
    ) as unknown as { doGenerate(o: unknown): Promise<{ from: string }> };
    expect(await broken.doGenerate({})).toEqual({ from: "fallback" });
    expect(onFallback).toHaveBeenCalledWith("boom");
  });
});
