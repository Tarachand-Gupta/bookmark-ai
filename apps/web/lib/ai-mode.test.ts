import { describe, expect, it } from "vitest";
import type { UserSettings } from "@bookmark-ai/types";
import {
  AI_MODE_COPY,
  describeAiNote,
  isAiMode,
  providerNeedsModel,
  resolveAiMode,
  resolveOwnKeyReady,
} from "./ai-mode";

const base: UserSettings = {
  provider: "google",
  baseUrl: null,
  model: null,
  apiKeySet: false,
  apiKeyLast4: null,
  aiMode: "included",
  ownKeyReady: false,
  liveServerUrl: null,
  onboardedAt: null,
  nativeSyncEnabled: true,
  nativeSyncFull: false,
  mcpTools: null,
  aiUsage: null,
};

describe("resolveAiMode", () => {
  it("prefers the explicit server field", () => {
    expect(resolveAiMode({ ...base, aiMode: "own" })).toBe("own");
    expect(resolveAiMode({ ...base, aiMode: "included", apiKeySet: true })).toBe("included");
  });

  it("derives from the stored key when an older server omits the field", () => {
    const legacy = { ...base, aiMode: undefined as unknown as UserSettings["aiMode"] };
    expect(resolveAiMode({ ...legacy, apiKeySet: true })).toBe("own");
    expect(resolveAiMode({ ...legacy, apiKeySet: false })).toBe("included");
    expect(resolveAiMode({ ...legacy, aiMode: "bogus" as UserSettings["aiMode"], apiKeySet: true })).toBe("own");
  });

  it("isAiMode narrows", () => {
    expect(isAiMode("own")).toBe(true);
    expect(isAiMode("included")).toBe(true);
    expect(isAiMode("free")).toBe(false);
    expect(isAiMode(null)).toBe(false);
  });
});

describe("BYOK completeness", () => {
  it("only Google works without a model", () => {
    expect(providerNeedsModel("google")).toBe(false);
    expect(providerNeedsModel("openai")).toBe(true);
    expect(providerNeedsModel("anthropic")).toBe(true);
    expect(providerNeedsModel("custom")).toBe(true);
  });

  it("prefers the server's ownKeyReady, else derives from provider + model", () => {
    const withFlag = (ready: boolean, rest: Partial<UserSettings> = {}) =>
      ({ ...base, apiKeySet: true, ...rest, ownKeyReady: ready }) as UserSettings;
    expect(resolveOwnKeyReady(withFlag(false, { provider: "google" }))).toBe(false);
    expect(resolveOwnKeyReady(withFlag(true, { provider: "openai", model: null }))).toBe(true);

    // Older payloads without the field fall back to the derivation.
    const legacy = (rest: Partial<UserSettings>) =>
      ({ ...base, ...rest, ownKeyReady: undefined }) as unknown as UserSettings;
    expect(resolveOwnKeyReady(legacy({ apiKeySet: false }))).toBe(false);
    expect(resolveOwnKeyReady(legacy({ apiKeySet: true, provider: "google" }))).toBe(true);
    expect(resolveOwnKeyReady(legacy({ apiKeySet: true, provider: "openai", model: null }))).toBe(false);
    expect(resolveOwnKeyReady(legacy({ apiKeySet: true, provider: "openai", model: "gpt-5" }))).toBe(true);
    expect(resolveOwnKeyReady(legacy({ apiKeySet: true, provider: "custom", model: "" }))).toBe(false);
  });

  it("maps the X-Ai-Note header value to the shared sentence", () => {
    expect(describeAiNote("own-key-incomplete")).toBe(AI_MODE_COPY.ownKeyIncompleteReply);
    expect(AI_MODE_COPY.ownKeyIncompleteReply).toMatch(/needs a model/);
    // The settings card shows the same note minus its reply-only tail.
    expect(AI_MODE_COPY.ownKeyIncompleteReply.startsWith(AI_MODE_COPY.ownKeyIncomplete)).toBe(true);
    expect(AI_MODE_COPY.ownKeyIncomplete).not.toMatch(/this reply/i);
    expect(describeAiNote("something-else")).toBeNull();
    expect(describeAiNote(null)).toBeNull();
    expect(describeAiNote(undefined)).toBeNull();
  });
});
