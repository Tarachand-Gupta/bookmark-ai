import { describe, expect, it } from "vitest";
import { tokenFresh } from "./live-token";

const SKEW = 10_000;

describe("tokenFresh", () => {
  it("is false when there is no cached token", () => {
    expect(tokenFresh(null, 1000, SKEW)).toBe(false);
  });

  it("is true when comfortably before expiry (more than skew left)", () => {
    // expires in 60s, well beyond the 10s skew
    expect(tokenFresh({ token: "t", exp: 60_000 }, 0, SKEW)).toBe(true);
  });

  it("is false within the skew window of expiry", () => {
    // 5s left (< 10s skew) → refresh
    expect(tokenFresh({ token: "t", exp: 60_000 }, 55_000, SKEW)).toBe(false);
  });

  it("is false exactly at the skew boundary (strictly greater than skew required)", () => {
    // exactly 10s left → not > skew → refresh
    expect(tokenFresh({ token: "t", exp: 60_000 }, 50_000, SKEW)).toBe(false);
  });

  it("is false once expired", () => {
    expect(tokenFresh({ token: "t", exp: 60_000 }, 70_000, SKEW)).toBe(false);
  });
});
