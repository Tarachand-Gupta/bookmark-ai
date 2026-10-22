import { describe, expect, it } from "vitest";
import {
  authDestinationFromSearch,
  displayName,
  safeAuthDestination,
  profileName,
  profileImage,
  profileNameUpdate,
} from "./auth-policy";
describe("auth destination", () => {
  it("preserves legacy local return links while preferring next and rejecting hostile targets", () => {
    expect(authDestinationFromSearch("?redirect_url=%2Fapp%3Fsettings%3Daccount")).toBe(
      "/app?settings=account",
    );
    expect(
      authDestinationFromSearch("?next=%2Fapp%2Flibrary&redirect_url=%2Fapp%3Fsettings%3Daccount"),
    ).toBe("/app/library");
    for (const target of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\r\nevil",
    ]) {
      expect(authDestinationFromSearch(`?redirect_url=${encodeURIComponent(target)}`)).toBe("/app");
      expect(
        authDestinationFromSearch(
          `?next=${encodeURIComponent(target)}&redirect_url=%2Fapp%3Fsettings%3Daccount`,
        ),
      ).toBe("/app");
    }
  });
  it("keeps local deep links and rejects external or parser-confusing redirects", () => {
    expect(safeAuthDestination("/app?settings=mcp")).toBe("/app?settings=mcp");
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\r\nevil",
      "javascript:alert(1)",
    ])
      expect(safeAuthDestination(value)).toBe("/app");
  });
  it("bounds and strips device/profile label control characters", () => {
    expect(displayName("  My\u0000 Mac\n ")).toBe("My Mac");
    expect(displayName("x".repeat(200))).toHaveLength(80);
    expect(displayName({ role: "admin" })).toBe("");
  });
  it("uses canonical full_name and preserves legacy-only metadata while updates synchronize fields", () => {
    expect(profileName({ display_name: "Legacy name" })).toBe("Legacy name");
    expect(profileName({ full_name: "Canonical", display_name: "Old web value" })).toBe(
      "Canonical",
    );
    expect(profileName({ full_name: "", display_name: "Fallback" })).toBe("Fallback");
    expect(profileNameUpdate(" New\n name ")).toEqual({
      full_name: "New name",
      display_name: "New name",
    });
  });
});

describe("provider profile metadata", () => {
  it("accepts a sanitized provider name without overriding canonical fields", () => {
    expect(profileName({ name: "  Provider\n Name  " })).toBe("Provider Name");
    expect(profileName({ name: { unexpected: true } })).toBe("");
    expect(profileName({ full_name: "Saved name", name: "Provider" })).toBe("Saved name");
    expect(profileName({ display_name: "Saved legacy", name: "Provider" })).toBe("Saved legacy");
  });
  it("prefers a valid avatar URL and falls back to a validated provider picture", () => {
    expect(
      profileImage({
        avatar_url: "https://images.example/avatar",
        picture: "https://images.example/provider",
      }),
    ).toBe("https://images.example/avatar");
    expect(
      profileImage({ avatar_url: "invalid", picture: "https://images.example/provider" }),
    ).toBe("https://images.example/provider");
    expect(profileImage({ picture: "https://images.example/provider" })).toBe(
      "https://images.example/provider",
    );
  });
  it("rejects unsafe, malformed, credential-bearing and non-HTTPS image URLs", () => {
    for (const picture of [
      "http://images.example/x",
      "javascript:alert(1)",
      "data:image/svg+xml,x",
      "//images.example/x",
      "https://",
      "https://user:pass@images.example/x",
      "https://images.example/\npath",
      "https://images.example/\\path",
      {},
      null,
    ]) {
      expect(profileImage({ picture })).toBeNull();
    }
    expect(profileImage(undefined)).toBeNull();
  });
});
