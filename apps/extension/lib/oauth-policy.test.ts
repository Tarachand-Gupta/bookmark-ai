import { describe, expect, it } from "vitest";
import { oauthCallback } from "./oauth-policy";
const target = "https://qa.chromiumapp.org/supabase";
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
