import { describe, expect, it } from "vitest";
import { isAllowedBridgePath } from "./bridge-guard";

describe("isAllowedBridgePath", () => {
  it("allows relative /api/ paths", () => {
    expect(isAllowedBridgePath("/api/me")).toBe(true);
    expect(isAllowedBridgePath("/api/bookmarks")).toBe(true);
    expect(isAllowedBridgePath("/api/sessions?limit=40")).toBe(true);
    expect(isAllowedBridgePath("/api/bookmarks/abc-123")).toBe(true);
  });

  it("rejects non-/api/ paths", () => {
    expect(isAllowedBridgePath("/")).toBe(false);
    expect(isAllowedBridgePath("/app")).toBe(false);
    expect(isAllowedBridgePath("/apix")).toBe(false); // must be exactly the /api/ prefix
    expect(isAllowedBridgePath("/sign-in")).toBe(false);
  });

  it("rejects absolute and scheme-relative URLs", () => {
    expect(isAllowedBridgePath("https://evil.com/api/me")).toBe(false);
    expect(isAllowedBridgePath("//evil.com/api/me")).toBe(false);
    expect(isAllowedBridgePath("/api/redirect?to=https://evil.com")).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isAllowedBridgePath("/api/../secret")).toBe(false);
    expect(isAllowedBridgePath("/api/a/../../etc")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isAllowedBridgePath(undefined)).toBe(false);
    expect(isAllowedBridgePath(null)).toBe(false);
    expect(isAllowedBridgePath(42)).toBe(false);
    expect(isAllowedBridgePath({ path: "/api/me" })).toBe(false);
  });
});
