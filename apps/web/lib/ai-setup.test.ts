import { describe, expect, it } from "vitest";
import { ownProviderRequest } from "./ai-setup";
const saved = {
  provider: "google",
  loadedProvider: "google",
  apiKey: "",
  apiKeySet: true,
  baseUrl: "",
  model: "",
} as const;
describe("own-provider activation requests", () => {
  it("activates a saved provider explicitly without transmitting or clearing its key", () => {
    expect(ownProviderRequest(saved)).toEqual({
      provider: "google",
      aiMode: "own",
      apiKey: undefined,
      baseUrl: undefined,
      model: undefined,
    });
  });
  it("requires a matching key source and complete model/endpoint before activation", () => {
    expect(ownProviderRequest({ ...saved, apiKeySet: false })).toBeNull();
    expect(ownProviderRequest({ ...saved, provider: "openai", model: "m" })).toBeNull();
    expect(ownProviderRequest({ ...saved, provider: "openai", apiKey: "new" })).toBeNull();
    expect(
      ownProviderRequest({ ...saved, provider: "custom", apiKey: "new", model: "m" }),
    ).toBeNull();
    expect(
      ownProviderRequest({ ...saved, provider: "openai", apiKey: "new", model: "   " }),
    ).toBeNull();
  });
  it("requires new supported-provider keys to be verified and blocks explicitly rejected custom keys", () => {
    const changed = { ...saved, provider: "openai" as const, apiKey: "new", model: "m" };
    expect(ownProviderRequest(changed)).toBeNull();
    expect(ownProviderRequest({ ...changed, keyVerified: true })?.aiMode).toBe("own");
    expect(ownProviderRequest({ ...changed, keyVerified: true, keyRejected: true })).toBeNull();
    const custom = { ...changed, provider: "custom" as const, baseUrl: "https://example.com/v1" };
    expect(ownProviderRequest(custom)?.model).toBe("m");
    expect(ownProviderRequest({ ...custom, keyRejected: true })).toBeNull();
  });
  it("sends a complete draft with explicit own mode and only the relevant endpoint", () => {
    expect(
      ownProviderRequest({
        ...saved,
        provider: "custom",
        apiKey: " new ",
        baseUrl: " https://example.com/v1 ",
        model: " m ",
      }),
    ).toEqual({
      aiMode: "own",
      provider: "custom",
      apiKey: "new",
      baseUrl: "https://example.com/v1",
      model: "m",
    });
    expect(
      ownProviderRequest({ ...saved, apiKey: " new ", baseUrl: "https://unused" })?.baseUrl,
    ).toBeUndefined();
  });
});
