import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, tool } from "ai";
import { z } from "zod";
import { buildIncludedModel, CLOUDFLARE_MODEL_ID } from "./ai-model";

beforeEach(() => {
  vi.stubEnv("INCLUDED_AI_PROVIDER", "cloudflare");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
  vi.stubEnv("OPENROUTER_API_KEY", "do-not-use");
  vi.stubEnv("GEMINI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Cloudflare included AI opt-in", () => {
  it("sends GLM, tools and low reasoning to the account's OpenAI-compatible endpoint", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        id: "test",
        model: CLOUDFLARE_MODEL_ID,
        choices: [
          { index: 0, message: { role: "assistant", content: "Ready" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const resolved = buildIncludedModel(null)!;
    expect(resolved.label).toContain("cloudflare:");
    const result = await generateText({
      model: resolved.model,
      prompt: "Find a bookmark",
      providerOptions: resolved.providerOptions,
      tools: { find: tool({ inputSchema: z.object({ query: z.string() }) }) },
    });
    expect(result.text).toBe("Ready");
    expect(fetch.mock.calls).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1/chat/completions`,
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(CLOUDFLARE_MODEL_ID);
    expect(body.reasoning_effort).toBe("low");
    expect(body.tools[0].function.name).toBe("find");
  });
  it("does not silently use OpenRouter when Cloudflare is selected but not configured", () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    expect(buildIncludedModel(null)).toBeNull();
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    expect(buildIncludedModel({} as any)?.tier).toBe("fallback");
  });
  it("validates account IDs before constructing an endpoint", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "../unexpected/path");
    expect(buildIncludedModel(null)).toBeNull();
  });
  it("leaves the current provider unchanged without an explicit opt-in", () => {
    vi.stubEnv("INCLUDED_AI_PROVIDER", "");
    expect(buildIncludedModel(null)?.label).toContain("openrouter:");
  });
});
