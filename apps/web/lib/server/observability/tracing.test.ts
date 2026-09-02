import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { GeminiClient, setTracingGate, traced } from "@bookmark-ai/engine";

/**
 * The engine's tracing core, exercised against a real in-memory OTel pipeline
 * (the engine has no test runner, so its tracing tests live here — same
 * arrangement as grounded-search.test.ts). Mirrors production wiring:
 * a dedicated provider handed to @langfuse/tracing (NOT registered globally)
 * plus a global AsyncLocalStorage context manager — see observability/register.ts.
 */

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  setLangfuseTracerProvider(provider);
});

afterEach(() => {
  exporter.reset();
  setTracingGate(async () => false); // back to the engine default
  vi.unstubAllGlobals();
});

/** Everything a span recorded, as one searchable string. */
function attributesJson(spanName: string): string {
  const span = exporter.getFinishedSpans().find((s) => s.name === spanName);
  expect(span, `span "${spanName}" was exported`).toBeDefined();
  return JSON.stringify(span!.attributes);
}

describe("traced", () => {
  it("runs the function untraced while the gate is off (the default)", async () => {
    const result = await traced("categorize", "should-not-exist", { input: { a: 1 } }, async () => 42);
    expect(result).toBe(42);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("exports a span with name, input and mapped output when the gate is on", async () => {
    setTracingGate(async (surface) => surface === "search");
    const result = await traced(
      "search",
      "search-bookmarks",
      { input: { query: "verilog", mode: "hybrid" }, output: (r: number) => ({ results: r }) },
      async () => 7,
    );
    expect(result).toBe(7);

    const attrs = attributesJson("search-bookmarks");
    expect(attrs).toContain("verilog");
    expect(attrs).toContain('\\"results\\":7');
    // The gate is per-surface: an off surface still runs plain.
    await traced("embed", "not-traced", {}, async () => 0);
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(["search-bookmarks"]);
  });

  it("rethrows errors and still ends the span, marked as an error", async () => {
    setTracingGate(async () => true);
    await expect(
      traced("embed", "embed-bookmark", { input: { id: "b1" } }, async () => {
        throw new Error("gemini exploded");
      }),
    ).rejects.toThrow("gemini exploded");

    const attrs = attributesJson("embed-bookmark");
    expect(attrs).toContain("ERROR");
    expect(attrs).toContain("gemini exploded");
  });
});

describe("gemini child observations", () => {
  const geminiResponse = {
    candidates: [{ content: { parts: [{ text: '{"category":"Development","tags":["ai"]}' }] } }],
    usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 150 },
  };

  function stubFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(geminiResponse), { status: 200 })),
    );
  }

  it("records a generation with usageDetails under an active traced span", async () => {
    stubFetch();
    setTracingGate(async () => true);
    const client = new GeminiClient("test-key-not-real");

    await traced("categorize", "categorize-bookmark", {}, () =>
      client.generateJson("categorize this", { type: "object" }),
    );

    const spans = exporter.getFinishedSpans();
    const generation = spans.find((s) => s.name === "gemini-generate-json");
    const parent = spans.find((s) => s.name === "categorize-bookmark");
    expect(generation).toBeDefined();
    expect(parent).toBeDefined();
    // The generation NESTS under the feature span.
    expect(generation!.parentSpanContext?.spanId).toBe(parent!.spanContext().spanId);

    const attrs = JSON.stringify(generation!.attributes);
    expect(attrs).toContain("gemini-2.5-flash");
    expect(attrs).toContain("categorize this"); // input prompt
    expect(attrs).toContain("Development"); // parsed output
    // usageMetadata (previously discarded) → usageDetails {input, output}.
    expect(attrs).toContain('\\"input\\":25');
    expect(attrs).toContain('\\"output\\":150');
  });

  it("creates NO observation when no span is active", async () => {
    stubFetch();
    const client = new GeminiClient("test-key-not-real");
    const parsed = await client.generateJson<{ category: string }>("categorize this", {
      type: "object",
    });
    expect(parsed.category).toBe("Development");
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
