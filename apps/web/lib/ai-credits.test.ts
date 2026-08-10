import { describe, expect, it } from "vitest";
import {
  TOKENS_PER_CREDIT,
  daysUntilReset,
  formatCredits,
  nextWeeklyResetUtc,
  toCreditsView,
  tokensToCredits,
} from "./ai-credits";

/** The shipped default budget: 1,000,000 tokens = 1,000 credits a week. */
const LIMIT = 1_000_000;

describe("tokensToCredits", () => {
  it("is a fixed 1,000 tokens per credit", () => {
    expect(TOKENS_PER_CREDIT).toBe(1000);
    expect(tokensToCredits(LIMIT)).toBe(1000);
    expect(tokensToCredits(312_480)).toBe(312);
  });

  it("floors, so the meter never overstates spend", () => {
    expect(tokensToCredits(999)).toBe(0);
    expect(tokensToCredits(1000)).toBe(1);
    expect(tokensToCredits(1999)).toBe(1);
  });

  it("collapses junk to 0 instead of rendering NaN", () => {
    expect(tokensToCredits(0)).toBe(0);
    expect(tokensToCredits(-5)).toBe(0);
    expect(tokensToCredits(Number.NaN)).toBe(0);
    expect(tokensToCredits(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("nextWeeklyResetUtc", () => {
  // Metering keys weeks by Monday 00:00 UTC (packages/engine/src/metering.ts).
  it("lands on the next Monday 00:00 UTC from any weekday", () => {
    // Tue 2026-08-11 → Mon 2026-08-17
    expect(nextWeeklyResetUtc(new Date("2026-08-11T13:45:00Z"))).toBe("2026-08-17T00:00:00.000Z");
    // Sun 2026-08-16 (late) → Mon 2026-08-17
    expect(nextWeeklyResetUtc(new Date("2026-08-16T23:59:59Z"))).toBe("2026-08-17T00:00:00.000Z");
    // Sat 2026-08-15 → Mon 2026-08-17
    expect(nextWeeklyResetUtc(new Date("2026-08-15T00:00:00Z"))).toBe("2026-08-17T00:00:00.000Z");
  });

  it("is a FULL week out on a Monday — the boundary just crossed is not the reset", () => {
    expect(nextWeeklyResetUtc(new Date("2026-08-17T00:00:00Z"))).toBe("2026-08-24T00:00:00.000Z");
    expect(nextWeeklyResetUtc(new Date("2026-08-17T23:00:00Z"))).toBe("2026-08-24T00:00:00.000Z");
  });

  it("crosses month and year boundaries", () => {
    // Mon 2026-12-28 → Mon 2027-01-04
    expect(nextWeeklyResetUtc(new Date("2026-12-28T10:00:00Z"))).toBe("2027-01-04T00:00:00.000Z");
    // Thu 2026-07-30 → Mon 2026-08-03
    expect(nextWeeklyResetUtc(new Date("2026-07-30T10:00:00Z"))).toBe("2026-08-03T00:00:00.000Z");
  });

  it("uses UTC days, not the local calendar day", () => {
    // 2026-08-16T23:30Z is a Sunday in UTC (a Monday in +02:00) — the reset is
    // still the UTC Monday a half hour later, not eight days away.
    expect(nextWeeklyResetUtc(new Date("2026-08-16T23:30:00Z"))).toBe("2026-08-17T00:00:00.000Z");
  });
});

describe("daysUntilReset", () => {
  it("rounds up and never reports 0 days", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    expect(daysUntilReset("2026-08-17T00:00:00.000Z", now)).toBe(6);
    expect(daysUntilReset("2026-08-12T00:00:00.000Z", now)).toBe(1);
    expect(daysUntilReset("2026-08-11T12:00:01.000Z", now)).toBe(1);
  });

  it("survives an unparseable timestamp", () => {
    expect(daysUntilReset("not-a-date", new Date("2026-08-11T12:00:00Z"))).toBe(0);
  });
});

describe("formatCredits", () => {
  it("groups digits", () => {
    expect(formatCredits(1000)).toBe("1,000");
    expect(formatCredits(0)).toBe("0");
    expect(formatCredits(312)).toBe("312");
  });
});

describe("toCreditsView", () => {
  const resetsAt = "2026-08-17T00:00:00.000Z";

  it("normalizes a fresh week", () => {
    expect(toCreditsView({ usedTokens: 0, limitTokens: LIMIT, resetsAt })).toEqual({
      usedCredits: 0,
      limitCredits: 1000,
      remainingCredits: 1000,
      percentUsed: 0,
      exhausted: false,
      resetsAt,
    });
  });

  it("computes the bar from raw tokens, not the floored credits", () => {
    // 500 tokens is not yet one credit, but it IS 0.05% of the budget.
    const view = toCreditsView({ usedTokens: 500, limitTokens: LIMIT, resetsAt })!;
    expect(view.usedCredits).toBe(0);
    expect(view.percentUsed).toBeCloseTo(0.05);
    expect(view.exhausted).toBe(false);
  });

  it("clamps an overshoot: the last request is charged after it streams", () => {
    const view = toCreditsView({ usedTokens: 1_004_321, limitTokens: LIMIT, resetsAt })!;
    expect(view.usedCredits).toBe(1000);
    expect(view.remainingCredits).toBe(0);
    expect(view.percentUsed).toBe(100);
    expect(view.exhausted).toBe(true);
  });

  it("treats exactly-at-limit as exhausted (matches the 402 wall's >=)", () => {
    expect(toCreditsView({ usedTokens: LIMIT, limitTokens: LIMIT, resetsAt })!.exhausted).toBe(true);
  });

  it("returns null for a missing or meaningless meter", () => {
    expect(toCreditsView(null)).toBeNull();
    expect(toCreditsView(undefined)).toBeNull();
    expect(toCreditsView({ usedTokens: 10, limitTokens: 0, resetsAt })).toBeNull();
    expect(toCreditsView({ usedTokens: 10, limitTokens: -1, resetsAt })).toBeNull();
  });

  it("survives a junk usage number", () => {
    const view = toCreditsView({ usedTokens: Number.NaN, limitTokens: LIMIT, resetsAt })!;
    expect(view.usedCredits).toBe(0);
    expect(view.percentUsed).toBe(0);
  });

  it("honors an admin-lowered limit", () => {
    const view = toCreditsView({ usedTokens: 150_000, limitTokens: 200_000, resetsAt })!;
    expect(view.limitCredits).toBe(200);
    expect(view.usedCredits).toBe(150);
    expect(view.remainingCredits).toBe(50);
    expect(view.percentUsed).toBe(75);
  });
});
