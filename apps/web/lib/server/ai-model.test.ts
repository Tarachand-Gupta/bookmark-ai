import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@bookmark-ai/db";
import type { GeminiClient } from "@bookmark-ai/engine";
import {
  buildIncludedModel,
  INCLUDED_FALLBACK_MODEL_ID,
  INCLUDED_MODEL_ID,
  INCLUDED_PRIMARY_MODEL_ID,
  OPENROUTER_MODEL_SETTINGS,
  isOwnKeyReady,
  ownModelId,
  pickChatModel,
  resolveChatCandidates,
  resolveChatModel,
  type ChatModelCandidates,
  type ResolvedChatModel,
} from "./ai-model";

/**
 * `pickChatModel` is the pure decision; `resolveChatCandidates` is exercised
 * against a stub Db whose single settings row we control (plaintext keys are
 * the legacy at-rest format, so no encryption secret is needed).
 */

const own = (overrides: Partial<ResolvedChatModel> = {}): ResolvedChatModel => ({
  model: {} as ResolvedChatModel["model"],
  label: "openai:gpt-4o",
  usesServerKey: false,
  source: "own",
  providerId: "openai",
  modelId: "gpt-4o",
  ...overrides,
});
const included = (): ResolvedChatModel => ({
  model: {} as ResolvedChatModel["model"],
  label: "google:gemini-3.8-flash (env)",
  usesServerKey: true,
  source: "included",
  providerId: "google",
  modelId: INCLUDED_MODEL_ID,
});
const c = (p: Partial<ChatModelCandidates>): ChatModelCandidates => ({
  aiMode: "included",
  hasStoredKey: false,
  own: null,
  included: null,
  ...p,
});

describe("pickChatModel", () => {
  it("own mode with a complete own config → own, never metered, even when exhausted", () => {
    const r = pickChatModel(c({ aiMode: "own", hasStoredKey: true, own: own(), included: included() }), { exhausted: true });
    expect(r).toEqual({ ok: true, resolved: own() });
  });

  it("included mode under the limit → the server Gemini, metered", () => {
    const r = pickChatModel(c({ own: own(), included: included() }), { exhausted: false });
    expect(r.ok && r.resolved.source).toBe("included");
    expect(r.ok && r.resolved.usesServerKey).toBe(true);
  });

  it("included mode, exhausted, own key stored → own-fallback, not metered", () => {
    const r = pickChatModel(c({ hasStoredKey: true, own: own(), included: included() }), { exhausted: true });
    expect(r).toEqual({ ok: true, resolved: own({ source: "own-fallback" }) });
  });

  it("included mode, exhausted, no own key → 402", () => {
    expect(pickChatModel(c({ included: included() }), { exhausted: true })).toEqual({ ok: false, status: 402 });
  });

  it("own mode but incomplete own config → included (metered) flagged own-key-incomplete", () => {
    const r = pickChatModel(c({ aiMode: "own", hasStoredKey: true, own: null, included: included() }), { exhausted: false });
    expect(r).toEqual({ ok: true, resolved: included(), note: "own-key-incomplete" });
    // Exhausted with nothing to fall back to is still the plain 402.
    expect(pickChatModel(c({ aiMode: "own", hasStoredKey: true, own: null, included: included() }), { exhausted: true })).toEqual({ ok: false, status: 402 });
  });

  it("never attaches the note in included mode or when the own key runs", () => {
    const a = pickChatModel(c({ aiMode: "included", hasStoredKey: true, own: null, included: included() }), { exhausted: false });
    expect(a.ok && "note" in a).toBe(false);
    const b = pickChatModel(c({ aiMode: "own", hasStoredKey: true, own: own(), included: included() }), { exhausted: false });
    expect(b.ok && "note" in b).toBe(false);
  });

  it("no server key at all → the own key if configured, else 503", () => {
    expect(pickChatModel(c({ own: own() }), { exhausted: false })).toEqual({ ok: true, resolved: own() });
    expect(pickChatModel(c({}), { exhausted: false })).toEqual({ ok: false, status: 503 });
    expect(pickChatModel(c({}), { exhausted: true })).toEqual({ ok: false, status: 503 });
  });
});

describe("isOwnKeyReady / ownModelId (the rule GET /api/settings and the resolver share)", () => {
  const cfg = (aiProvider: string | null, aiModel: string | null = null, aiBaseUrl: string | null = null) => ({ aiProvider, aiModel, aiBaseUrl });

  it("needs a key and a provider", () => {
    expect(isOwnKeyReady(null, true)).toBe(false);
    expect(isOwnKeyReady(cfg("google"), false)).toBe(false);
    expect(isOwnKeyReady(cfg(null), true)).toBe(false);
    expect(isOwnKeyReady(cfg("  "), true)).toBe(false);
  });

  it("google is ready without a model; openai/anthropic need one; custom also needs a base URL", () => {
    expect(isOwnKeyReady(cfg("google"), true)).toBe(true);
    expect(isOwnKeyReady(cfg("google", "gemini-2.5-pro"), true)).toBe(true);
    expect(isOwnKeyReady(cfg("openai"), true)).toBe(false);
    expect(isOwnKeyReady(cfg("openai", "gpt-4o"), true)).toBe(true);
    expect(isOwnKeyReady(cfg("anthropic", ""), true)).toBe(false);
    expect(isOwnKeyReady(cfg("anthropic", "claude-sonnet-4-5"), true)).toBe(true);
    expect(isOwnKeyReady(cfg("custom", "m"), true)).toBe(false);
    expect(isOwnKeyReady(cfg("custom", "m", "https://llm.example.com/v1"), true)).toBe(true);
    expect(isOwnKeyReady(cfg("something-else", "m"), true)).toBe(false);
  });

  it("ownModelId defaults only Google", () => {
    expect(ownModelId(cfg("google"))).toBe(INCLUDED_MODEL_ID);
    expect(ownModelId(cfg("google", "gemini-2.5-pro"))).toBe("gemini-2.5-pro");
    expect(ownModelId(cfg("openai"))).toBeNull();
    expect(ownModelId(cfg("openai", "gpt-4o"))).toBe("gpt-4o");
  });
});

describe("resolveChatCandidates", () => {
  const savedEnv = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-server-key";
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedEnv;
  });

  const gemini = {} as GeminiClient;
  const dbWith = (row: Record<string, unknown> | null): Db =>
    ({ execute: async () => ({ rows: row ? [row] : [] }) }) as unknown as Db;
  const baseRow = { user_id: "u", ai_provider: null, ai_base_url: null, ai_api_key: null, ai_model: null, ai_mode: null, updated_at: "t" };

  it("no settings row → included mode, included candidate only", async () => {
    const r = await resolveChatCandidates({ db: dbWith(null), userId: "u", gemini });
    expect(r.aiMode).toBe("included");
    expect(r.hasStoredKey).toBe(false);
    expect(r.own).toBeNull();
    expect(r.included?.modelId).toBe(INCLUDED_MODEL_ID);
    expect(r.included?.providerId).toBe("google");
  });

  it("a complete own config with a NULL mode derives 'own' (legacy)", async () => {
    const r = await resolveChatCandidates({
      db: dbWith({ ...baseRow, ai_provider: "openai", ai_api_key: "sk-plain", ai_model: "gpt-4o" }),
      userId: "u",
      gemini,
    });
    expect(r.aiMode).toBe("own");
    expect(r.hasStoredKey).toBe(true);
    expect(r.own).toMatchObject({ providerId: "openai", modelId: "gpt-4o", source: "own", usesServerKey: false, label: "openai:gpt-4o" });
  });

  it("an explicit 'included' mode with a stored key keeps BOTH candidates (fallback-ready)", async () => {
    const r = await resolveChatCandidates({
      db: dbWith({ ...baseRow, ai_provider: "anthropic", ai_api_key: "sk-ant", ai_model: "claude-sonnet-4-5", ai_mode: "included" }),
      userId: "u",
      gemini,
    });
    expect(r.aiMode).toBe("included");
    expect(r.own?.providerId).toBe("anthropic");
    expect(r.included).not.toBeNull();
  });

  it("a Google key without a model is COMPLETE — it runs gemini-3.8-flash", async () => {
    const r = await resolveChatCandidates({
      db: dbWith({ ...baseRow, ai_provider: "google", ai_api_key: "k", ai_mode: "own" }),
      userId: "u",
      gemini,
    });
    expect(r.hasStoredKey).toBe(true);
    expect(r.aiMode).toBe("own");
    expect(r.own).toMatchObject({ providerId: "google", modelId: INCLUDED_MODEL_ID, source: "own", usesServerKey: false, label: `google:${INCLUDED_MODEL_ID}` });
  });

  it("an OpenAI/Anthropic key without a model is an incomplete own config", async () => {
    for (const provider of ["openai", "anthropic"]) {
      const r = await resolveChatCandidates({
        db: dbWith({ ...baseRow, ai_provider: provider, ai_api_key: "k", ai_mode: "own" }),
        userId: "u",
        gemini,
      });
      expect(r.hasStoredKey).toBe(true);
      expect(r.own).toBeNull();
      expect(r.aiMode).toBe("own");
    }
  });

  it("custom without a base URL is incomplete; no env key → no included candidate", async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await resolveChatCandidates({
      db: dbWith({ ...baseRow, ai_provider: "custom", ai_api_key: "k", ai_model: "m" }),
      userId: "u",
      gemini: null,
    });
    expect(r.own).toBeNull();
    expect(r.included).toBeNull();
  });

  it("resolveChatModel carries the note for an own-mode incomplete config", async () => {
    const r = await resolveChatModel({
      db: dbWith({ ...baseRow, ai_provider: "openai", ai_api_key: "sk", ai_mode: "own" }),
      userId: "u",
      gemini,
    });
    expect(r).toMatchObject({ ok: true, note: "own-key-incomplete" });
    expect(r.ok && r.resolved.source).toBe("included");
  });

  it("resolveChatModel composes both halves", async () => {
    const r = await resolveChatModel({
      db: dbWith({ ...baseRow, ai_provider: "openai", ai_api_key: "sk", ai_model: "gpt-4o", ai_mode: "included" }),
      userId: "u",
      gemini,
      exhausted: true,
    });
    expect(r.ok && r.resolved.source).toBe("own-fallback");
  });
});

/**
 * The INCLUDED stack is env-driven: OpenRouter primary + Gemini fallback, either
 * alone, or nothing. `buildIncludedModel` is the single place that decides.
 */
describe("buildIncludedModel — the included AI stack", () => {
  const geminiStub = {} as GeminiClient;
  const saved = { gem: process.env.GEMINI_API_KEY, or: process.env.OPENROUTER_API_KEY };

  afterEach(() => {
    if (saved.gem === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.gem;
    if (saved.or === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.or;
  });

  it("runs GLM through OpenRouter with a Gemini fallback when BOTH keys are set", () => {
    process.env.GEMINI_API_KEY = "gem";
    process.env.OPENROUTER_API_KEY = "or";
    const m = buildIncludedModel(geminiStub);
    expect(m?.modelId).toBe(INCLUDED_PRIMARY_MODEL_ID);
    expect(m?.tier).toBe("primary");
    expect(m?.usesServerKey).toBe(true);
    expect(m?.label).toContain("gemini fallback");
    // GLM's LOW reasoning effort is a MODEL SETTING (the provider ignores it as
    // a per-request providerOption); Gemini's thinking config rides along as a
    // providerOption so a mid-request handoff still streams thoughts.
    expect(OPENROUTER_MODEL_SETTINGS.reasoning).toEqual({ enabled: true, effort: "low" });
    expect(m?.providerOptions?.google).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" },
    });
  });

  it("runs Gemini alone (tier fallback) when OpenRouter has no key", () => {
    process.env.GEMINI_API_KEY = "gem";
    delete process.env.OPENROUTER_API_KEY;
    const m = buildIncludedModel(geminiStub);
    expect(m?.modelId).toBe(INCLUDED_FALLBACK_MODEL_ID);
    expect(m?.tier).toBe("fallback");
    expect(m?.providerId).toBe("google");
  });

  it("runs OpenRouter alone when there is no server Gemini", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.OPENROUTER_API_KEY = "or";
    const m = buildIncludedModel(null);
    expect(m?.modelId).toBe(INCLUDED_PRIMARY_MODEL_ID);
    expect(m?.tier).toBe("primary");
  });

  it("is null with neither key — there is no included tier", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(buildIncludedModel(null)).toBeNull();
  });
});
