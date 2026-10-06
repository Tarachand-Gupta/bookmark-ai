import { describe, expect, it } from "vitest";
import { oauthCallback, isOAuthBridgeCallback } from "./oauth-policy";
const target = "https://qa.chromiumapp.org/supabase";
it.each(["http://localhost:3100", "https://www.bookmark-ai.cloud"])(
  "accepts Safari callbacks only on the configured approved origin %s", (app) => {
    expect(isOAuthBridgeCallback(app + "/auth/extension-callback?state=bound&code=one", app)).toBe(true);
    expect(isOAuthBridgeCallback("https://evil.example/auth/extension-callback", app)).toBe(false);
    expect(isOAuthBridgeCallback(app + "/app", app)).toBe(false);
    const other = app.startsWith("https:") ? "http://localhost:3100" : "https://www.bookmark-ai.cloud";
    expect(isOAuthBridgeCallback(other + "/auth/extension-callback", app)).toBe(false);
  },
);
it("rejects a configured unapproved Safari callback origin", () => {
  expect(isOAuthBridgeCallback("https://evil.example/auth/extension-callback", "https://evil.example")).toBe(false);
});
describe("OAuth callback binding", () => {
  it("accepts the one code bound to the requested callback and state", () =>
    expect(oauthCallback(target + "?state=random&code=code", target, "random")).toBe("code"));
  it.each([
    target + "?state=wrong&code=code",
    "https://evil.example/supabase?state=random&code=code",
    target + "/other?state=random&code=code",
    target + "?state=random&state=random&code=code",
    target + "?state=random&code=a&code=b",
    target + "?state=random&error=access_denied",
    target + "?state=random&code=code#token",
  ])("rejects mismatched or ambiguous callbacks %s", (url) =>
    expect(() => oauthCallback(url, target, "random")).toThrow(),
  );
});
