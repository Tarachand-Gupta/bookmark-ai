import { describe, expect, it } from "vitest";
import { displayName, safeAuthDestination, profileName, profileNameUpdate } from "./auth-policy";
describe("auth destination", () => {
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
    expect(profileName({ full_name: "Canonical", display_name: "Old web value" })).toBe("Canonical");
    expect(profileName({ full_name: "", display_name: "Fallback" })).toBe("Fallback");
    expect(profileNameUpdate(" New\n name ")).toEqual({ full_name: "New name", display_name: "New name" });
  });
});
