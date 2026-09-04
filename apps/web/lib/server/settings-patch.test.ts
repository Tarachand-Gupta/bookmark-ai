import { describe, expect, it } from "vitest";
import { updateUserSettingsSchema } from "@bookmark-ai/types";
import { deriveAiMode } from "./ai-mode";
import {
  buildSettingsPatch,
  ENCRYPTION_UNAVAILABLE_MESSAGE,
  OWN_MODE_NEEDS_KEY_MESSAGE,
} from "./settings-patch";

const encrypt = (plain: string) => `enc:test:${plain}`;
const parse = (body: unknown) => {
  const r = updateUserSettingsSchema.safeParse(body);
  if (!r.success) throw new Error(r.error.message);
  return r.data;
};
const build = (body: unknown, hasStoredKey: boolean) =>
  buildSettingsPatch(parse(body), { hasStoredKey, encrypt });

describe("buildSettingsPatch — AI mode", () => {
  it("a mode switch touches ONLY ai_mode (the key survives)", () => {
    expect(build({ aiMode: "included" }, true)).toEqual({ ok: true, patch: { aiMode: "included" } });
    expect(build({ aiMode: "own" }, true)).toEqual({ ok: true, patch: { aiMode: "own" } });
  });

  it("refuses 'own' when no key is stored and none arrives", () => {
    expect(build({ aiMode: "own" }, false)).toEqual({ ok: false, status: 400, error: OWN_MODE_NEEDS_KEY_MESSAGE });
  });

  it("allows 'own' when the key arrives in the same request", () => {
    expect(build({ aiMode: "own", apiKey: "sk-new" }, false)).toEqual({
      ok: true,
      patch: { aiApiKey: "enc:test:sk-new", aiMode: "own" },
    });
  });

  it("a new key implies 'own' unless aiMode is explicit", () => {
    expect(build({ apiKey: "sk-new" }, false)).toEqual({ ok: true, patch: { aiApiKey: "enc:test:sk-new", aiMode: "own" } });
    // Explicit wins: save the key but stay on the included free AI (fallback-ready).
    expect(build({ apiKey: "sk-new", aiMode: "included" }, false)).toEqual({
      ok: true,
      patch: { aiApiKey: "enc:test:sk-new", aiMode: "included" },
    });
  });

  it('apiKey: "" removes the key AND sets included', () => {
    expect(build({ apiKey: "" }, true)).toEqual({ ok: true, patch: { aiApiKey: null, aiMode: "included" } });
    expect(build({ apiKey: "   " }, true)).toEqual({ ok: true, patch: { aiApiKey: null, aiMode: "included" } });
  });

  it('apiKey: "" together with aiMode: "own" is a contradiction → 400', () => {
    expect(build({ apiKey: "", aiMode: "own" }, true)).toEqual({ ok: false, status: 400, error: OWN_MODE_NEEDS_KEY_MESSAGE });
  });

  it("encryption failure is a clean 500, never a plaintext write", () => {
    const r = buildSettingsPatch(parse({ apiKey: "sk" }), {
      hasStoredKey: false,
      encrypt: () => {
        throw new Error("no secret");
      },
    });
    expect(r).toEqual({ ok: false, status: 500, error: ENCRYPTION_UNAVAILABLE_MESSAGE });
  });
});

describe("buildSettingsPatch — provider / model", () => {
  it("changing provider keeps the key AND the model", () => {
    expect(build({ provider: "openai" }, true)).toEqual({
      ok: true,
      patch: { aiProvider: "openai", aiBaseUrl: null },
    });
  });

  it("the Settings form's provider + model save sets both", () => {
    expect(build({ provider: "anthropic", model: "claude-sonnet-4-5" }, true)).toEqual({
      ok: true,
      patch: { aiProvider: "anthropic", aiBaseUrl: null, aiModel: "claude-sonnet-4-5" },
    });
  });

  it('model: "" clears the model explicitly', () => {
    expect(build({ provider: "openai", model: "" }, true)).toEqual({
      ok: true,
      patch: { aiProvider: "openai", aiBaseUrl: null, aiModel: null },
    });
    expect(build({ model: "" }, true)).toEqual({ ok: true, patch: { aiModel: null } });
  });

  it("keeps a base URL only for the custom provider", () => {
    expect(build({ provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m" }, true)).toEqual({
      ok: true,
      patch: { aiProvider: "custom", aiBaseUrl: "https://llm.example.com/v1", aiModel: "m" },
    });
    expect(build({ provider: "google", baseUrl: "https://llm.example.com/v1" }, true)).toEqual({
      ok: true,
      patch: { aiProvider: "google", aiBaseUrl: null },
    });
  });
});

describe("buildSettingsPatch — unrelated fields stay absent = keep", () => {
  it("an onboarded-only PATCH never touches the AI config", () => {
    const r = build({ onboarded: true }, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.patch)).toEqual(["onboardedAt"]);
      expect(typeof r.patch.onboardedAt).toBe("string");
    }
  });

  it("live server url, sync toggles and mcp tools map as before", () => {
    expect(build({ liveServerUrl: "" }, false)).toEqual({ ok: true, patch: { liveServerUrl: null } });
    expect(build({ liveServerUrl: "https://live.example.com" }, false)).toEqual({
      ok: true,
      patch: { liveServerUrl: "https://live.example.com" },
    });
    expect(build({ nativeSyncEnabled: false, nativeSyncFull: true }, false)).toEqual({
      ok: true,
      patch: { nativeSyncEnabled: false, nativeSyncFull: true },
    });
    expect(build({ mcpTools: null }, false)).toEqual({ ok: true, patch: { mcpToolsJson: null } });
    expect(build({ mcpTools: ["search_bookmarks"] }, false)).toEqual({
      ok: true,
      patch: { mcpToolsJson: '["search_bookmarks"]' },
    });
  });
});

describe("deriveAiMode", () => {
  it("returns the stored mode when valid, else the legacy derivation", () => {
    expect(deriveAiMode("own", false)).toBe("own");
    expect(deriveAiMode("included", true)).toBe("included");
    expect(deriveAiMode(null, true)).toBe("own");
    expect(deriveAiMode(null, false)).toBe("included");
    expect(deriveAiMode(undefined, false)).toBe("included");
    expect(deriveAiMode("garbage", true)).toBe("own");
  });
});
