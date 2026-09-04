import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creditsSummary, resetLabel, tokensToCredits } from "./aiCredits";

describe("tokensToCredits", () => {
  it("floors at 1,000 tokens per credit and never goes negative", () => {
    assert.equal(tokensToCredits(999), 0);
    assert.equal(tokensToCredits(1_000), 1);
    assert.equal(tokensToCredits(312_480), 312);
    assert.equal(tokensToCredits(-5), 0);
    assert.equal(tokensToCredits(Number.NaN), 0);
  });
});

describe("creditsSummary", () => {
  it("normalises the weekly meter", () => {
    const s = creditsSummary({ usedTokens: 250_000, limitTokens: 1_000_000, resetsAt: "2026-09-07T00:00:00.000Z" });
    assert.deepEqual(s, { used: 250, limit: 1000, remaining: 750, fraction: 0.25 });
  });
  it("clamps overspend to the limit", () => {
    const s = creditsSummary({ usedTokens: 5_000_000, limitTokens: 1_000_000, resetsAt: "" });
    assert.equal(s?.used, 1000);
    assert.equal(s?.remaining, 0);
    assert.equal(s?.fraction, 1);
  });
  it("is null without a meter", () => {
    assert.equal(creditsSummary(null), null);
  });
});

describe("resetLabel", () => {
  it("says Monday, or tomorrow on a Sunday", () => {
    const wednesday = new Date("2026-09-02T12:00:00Z");
    assert.equal(resetLabel("2026-09-07T00:00:00.000Z", wednesday), "Resets Monday");
    const sunday = new Date("2026-09-06T12:00:00Z");
    assert.equal(resetLabel("2026-09-07T00:00:00.000Z", sunday), "Resets tomorrow");
    assert.equal(resetLabel("garbage"), "Resets every Monday");
    assert.equal(resetLabel(null), "Resets every Monday");
  });
});
