import { describe, expect, it } from "vitest";
import { recentlyCreatedAccount } from "./account-readiness";
describe("fresh-account presentation hint", () => {
  const now = Date.parse("2026-10-09T00:00:00Z");
  it("labels recently created accounts during the initial readiness request", () => {
    expect(recentlyCreatedAccount(new Date(now - 30_000).toISOString(), now)).toBe(true);
  });
  it("keeps returning accounts on the ordinary opening screen", () => {
    expect(recentlyCreatedAccount(new Date(now - 300_000).toISOString(), now)).toBe(false);
  });
  it("ignores missing, malformed and future timestamps", () => {
    expect(recentlyCreatedAccount(undefined, now)).toBe(false);
    expect(recentlyCreatedAccount("not-a-date", now)).toBe(false);
    expect(recentlyCreatedAccount(new Date(now + 1000).toISOString(), now)).toBe(false);
  });
});
