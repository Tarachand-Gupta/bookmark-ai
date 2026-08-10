import { describe, expect, it } from "vitest";
import { MCP_LIMITS, mcpWindows, retryAfterSeconds } from "@/lib/server/mcp/limits";

/** A Wednesday, mid-day UTC — far from any boundary, so the maths is unambiguous. */
const WEDNESDAY = Date.parse("2026-08-12T13:47:31.500Z");

describe("mcpWindows", () => {
  it("returns one window per configured tier, with its cap", () => {
    const windows = mcpWindows(WEDNESDAY);
    expect(windows.map((w) => w.kind)).toEqual(MCP_LIMITS.map((l) => l.kind));
    expect(windows.map((w) => w.max)).toEqual(MCP_LIMITS.map((l) => l.max));
  });

  it("floors the short windows onto a fixed epoch grid", () => {
    const [minute, five] = mcpWindows(WEDNESDAY);
    expect(minute.bucket).toBe(`minute:${Date.parse("2026-08-12T13:47:00.000Z")}`);
    expect(minute.resetAtMs).toBe(Date.parse("2026-08-12T13:48:00.000Z"));
    expect(five.bucket).toBe(`five_minutes:${Date.parse("2026-08-12T13:45:00.000Z")}`);
    expect(five.resetAtMs).toBe(Date.parse("2026-08-12T13:50:00.000Z"));
  });

  it("keys the day window on the UTC date and resets at midnight UTC", () => {
    const day = mcpWindows(WEDNESDAY).find((w) => w.kind === "day");
    expect(day?.bucket).toBe("day:2026-08-12");
    expect(day?.resetAtMs).toBe(Date.parse("2026-08-13T00:00:00.000Z"));
  });

  it("keys the week window on the ISO week's Monday", () => {
    const week = (ms: number) => mcpWindows(ms).find((w) => w.kind === "week");
    // Wednesday, and the Monday/Sunday that bracket it, all share one bucket.
    expect(week(WEDNESDAY)?.bucket).toBe("week:2026-08-10");
    expect(week(Date.parse("2026-08-10T00:00:00.000Z"))?.bucket).toBe("week:2026-08-10");
    expect(week(Date.parse("2026-08-16T23:59:59.999Z"))?.bucket).toBe("week:2026-08-10");
    // The next Monday starts a new one.
    expect(week(Date.parse("2026-08-17T00:00:00.000Z"))?.bucket).toBe("week:2026-08-17");
    expect(week(WEDNESDAY)?.resetAtMs).toBe(Date.parse("2026-08-17T00:00:00.000Z"));
  });

  it("gives every window a bucket unique to its instance", () => {
    const buckets = mcpWindows(WEDNESDAY).map((w) => w.bucket);
    expect(new Set(buckets).size).toBe(buckets.length);
    // A later minute rolls to a different bucket; the same minute does not.
    expect(mcpWindows(WEDNESDAY + 60_000)[0].bucket).not.toBe(buckets[0]);
    expect(mcpWindows(WEDNESDAY + 500)[0].bucket).toBe(buckets[0]);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up to the next whole second", () => {
    const minute = mcpWindows(WEDNESDAY)[0];
    // 13:47:31.5 → 13:48:00 is 28.5s.
    expect(retryAfterSeconds(minute, WEDNESDAY)).toBe(29);
  });

  it("never reports zero, even at the exact boundary", () => {
    const minute = mcpWindows(WEDNESDAY)[0];
    expect(retryAfterSeconds(minute, minute.resetAtMs)).toBe(1);
  });
});
