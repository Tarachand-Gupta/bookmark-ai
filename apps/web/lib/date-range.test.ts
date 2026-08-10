import { describe, expect, it } from "vitest";
import { savedAtLowerBound, savedAtUpperBoundExclusive } from "@bookmark-ai/db";
import { DATE_RANGE_PRESETS, formatRangeLabel, isDateOnly, oneMonthBack } from "./date-range";

/**
 * The Date filter now accepts a full ISO datetime as well as a YYYY-MM-DD day, so
 * two things need pinning down: the presets' relative math, and how the DB widens
 * either bound shape into a `saved_at` interval.
 *
 * The bound helpers are imported through the package index (@bookmark-ai/db)
 * rather than by file path — the index does pull in @libsql/client, but that
 * resolves fine under vitest since apps/web depends on it directly (gotcha 9),
 * and nothing here opens a connection.
 *
 * The regression the upper-bound cases cover: the filter used to compare the
 * YYYY-MM-DD `saved_day` column, and moving to `saved_at` makes an INCLUSIVE
 * upper bound wrong in a way that only shows up on second-precision timestamps
 * ('Z' sorts after '.', so "…T23:59:59Z" > "…T23:59:59.999Z").
 */

describe("isDateOnly", () => {
  it("separates whole-day bounds from instants", () => {
    expect(isDateOnly("2026-08-11")).toBe(true);
    expect(isDateOnly("2026-08-11T09:00:00.000Z")).toBe(false);
    expect(isDateOnly("2026-8-1")).toBe(false);
  });
});

describe("savedAtLowerBound", () => {
  it("expands a date-only bound to the day's first instant", () => {
    expect(savedAtLowerBound("2026-08-11")).toBe("2026-08-11T00:00:00.000Z");
  });

  it("normalizes a datetime to UTC Z form", () => {
    expect(savedAtLowerBound("2026-08-11T09:14:03Z")).toBe("2026-08-11T09:14:03.000Z");
  });

  it("normalizes an offset-bearing datetime to the same instant in Z form", () => {
    // +05:30 — the stored timestamps are all Z, so an offset bound has to be
    // converted or the string compare reads a different timezone's digits.
    expect(savedAtLowerBound("2026-08-11T14:44:03+05:30")).toBe("2026-08-11T09:14:03.000Z");
  });

  it("returns an unparseable bound untouched rather than throwing", () => {
    expect(savedAtLowerBound("last tuesday")).toBe("last tuesday");
  });
});

describe("savedAtUpperBoundExclusive", () => {
  it("expands a date-only bound to the NEXT day's first instant", () => {
    expect(savedAtUpperBoundExclusive("2026-08-11")).toBe("2026-08-12T00:00:00.000Z");
  });

  it("rolls over month and year ends", () => {
    expect(savedAtUpperBoundExclusive("2026-08-31")).toBe("2026-09-01T00:00:00.000Z");
    expect(savedAtUpperBoundExclusive("2026-12-31")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("includes a no-millis end-of-day timestamp on the `to` day", () => {
    // The whole point of the half-open interval: this row is INSIDE `to=2026-08-11`
    // even though it sorts after "2026-08-11T23:59:59.999Z" lexicographically.
    const bound = savedAtUpperBoundExclusive("2026-08-11");
    expect("2026-08-11T23:59:59Z" < bound).toBe(true);
    expect("2026-08-11T23:59:59.999Z" < bound).toBe(true);
  });

  it("excludes the next day's first instant", () => {
    const bound = savedAtUpperBoundExclusive("2026-08-11");
    expect("2026-08-12T00:00:00.000Z" < bound).toBe(false);
  });

  it("keeps a caller-supplied datetime `to` inclusive (instant + 1ms)", () => {
    const bound = savedAtUpperBoundExclusive("2026-08-11T09:14:03.221Z");
    expect(bound).toBe("2026-08-11T09:14:03.222Z");
    expect("2026-08-11T09:14:03.221Z" < bound).toBe(true);
    expect("2026-08-11T09:14:03.222Z" < bound).toBe(false);
  });

  it("returns an unparseable bound untouched rather than throwing", () => {
    expect(savedAtUpperBoundExclusive("whenever")).toBe("whenever");
    // An impossible-but-well-formed day is rolled over by the platform parser
    // (Feb 30 2026 → Mar 2), not rejected — it still yields a usable bound.
    expect(savedAtUpperBoundExclusive("2026-02-30")).toBe("2026-03-03T00:00:00.000Z");
  });
});

describe("date range presets", () => {
  const now = new Date("2026-08-11T09:14:03.221Z");

  it("offers the six quick windows in rail order", () => {
    expect(DATE_RANGE_PRESETS.map((p) => p.label)).toEqual([
      "Last hour",
      "Last 12 hours",
      "Last 24 hours",
      "Last 7 days",
      "Last month",
      "This year",
    ]);
  });

  it("computes sub-day windows as ISO datetimes ending at now", () => {
    const by = (id: string) => DATE_RANGE_PRESETS.find((p) => p.id === id)!.from(now);
    expect(by("1h")).toBe("2026-08-11T08:14:03.221Z");
    expect(by("12h")).toBe("2026-08-10T21:14:03.221Z");
    expect(by("24h")).toBe("2026-08-10T09:14:03.221Z");
    expect(by("7d")).toBe("2026-08-04T09:14:03.221Z");
  });

  it("every preset's bound is a datetime the API bound schema shape accepts", () => {
    for (const p of DATE_RANGE_PRESETS) {
      const value = p.from(now);
      expect(isDateOnly(value)).toBe(false);
      expect(Number.isNaN(Date.parse(value))).toBe(false);
      // Open-ended ("up to now"), so a lower bound is all a preset ever sets.
      expect(savedAtLowerBound(value)).toBe(value);
    }
  });
});

describe("oneMonthBack", () => {
  it("steps back a calendar month", () => {
    expect(oneMonthBack(new Date(2026, 7, 11, 9, 14)).getMonth()).toBe(6);
    expect(oneMonthBack(new Date(2026, 7, 11, 9, 14)).getDate()).toBe(11);
  });

  it("clamps to the target month's last day instead of rolling over", () => {
    // Naive setMonth(-1) turns Mar 31 into Mar 3 (Feb 31 overflows).
    const back = oneMonthBack(new Date(2026, 2, 31, 12, 0));
    expect(back.getMonth()).toBe(1);
    expect(back.getDate()).toBe(28);
  });

  it("crosses the year boundary", () => {
    const back = oneMonthBack(new Date(2026, 0, 15, 12, 0));
    expect(back.getFullYear()).toBe(2025);
    expect(back.getMonth()).toBe(11);
  });
});

describe("formatRangeLabel", () => {
  it("states the year once for a same-year day range", () => {
    const label = formatRangeLabel("2026-08-03", "2026-08-10");
    expect(label).toContain(" – ");
    expect(label.match(/2026/g)).toHaveLength(1);
  });

  it("says which side a one-sided day range is open on", () => {
    expect(formatRangeLabel("2026-08-03", undefined)).toMatch(/^Since /);
    expect(formatRangeLabel(undefined, "2026-08-03")).toMatch(/^Until /);
  });

  it("switches to an instant label when a bound carries a time", () => {
    // Locale/timezone-independent assertion: a time is present (a colon appears
    // after the date part), which a whole-day label never has.
    const label = formatRangeLabel("2026-08-10T15:00:00.000Z", undefined);
    expect(label).toMatch(/^Since /);
    expect(label).toContain(":");
    expect(formatRangeLabel("2026-08-10", undefined)).not.toContain(":");
  });

  it("falls back to the raw value when a bound won't parse", () => {
    expect(formatRangeLabel("garbage", undefined)).toBe("garbage");
  });

  it("has a label for no range at all", () => {
    expect(formatRangeLabel(undefined, undefined)).toBe("Date");
  });
});
