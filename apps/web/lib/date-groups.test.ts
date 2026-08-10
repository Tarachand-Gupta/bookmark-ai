import { describe, expect, it } from "vitest";
import type { Bookmark } from "@bookmark-ai/types";
import { bookmarkLocalDay, groupBookmarksByDate, localYmd } from "./date-groups";

/**
 * The regression these cover: buckets used to compare the UTC date portion of
 * `savedAt` against LOCAL calendar boundaries, so anywhere east of Greenwich a
 * bookmark saved before the UTC rollover fell one bucket too far back while its
 * own card (which formats locally) said "Today".
 *
 * `process.env.TZ` is set per-test rather than with fake timers: the bug is
 * purely about which timezone a date string is read in, and `now` is injectable,
 * so no clock needs faking. Node re-reads TZ lazily, so each block re-asserts it.
 */

function bookmark(savedAt: string, id = savedAt): Bookmark {
  return {
    id,
    url: "https://example.com/",
    domain: "example.com",
    title: "Example",
    description: null,
    og: {},
    source: { browser: "chrome", device: "laptop", savedAt },
    category: "General",
    tags: [],
    createdAt: savedAt,
    embedded: false,
  };
}

/** Run `fn` with the process timezone pinned, then restore it. */
function inTimeZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = previous;
  }
}

describe("localYmd", () => {
  it("formats a local calendar day, zero-padded", () => {
    expect(localYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localYmd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("bookmarkLocalDay", () => {
  it("reads the day in the viewer's timezone, not UTC", () => {
    inTimeZone("Asia/Kolkata", () => {
      // 23:30 UTC on the 9th is 05:00 local on the 10th (UTC+05:30).
      expect(bookmarkLocalDay(bookmark("2026-08-09T23:30:00.000Z"))).toBe("2026-08-10");
      // 00:10 local on the 10th is still the 9th in UTC.
      expect(bookmarkLocalDay(bookmark("2026-08-09T18:40:00.000Z"))).toBe("2026-08-10");
    });
  });

  it("honours an explicit offset in the timestamp", () => {
    inTimeZone("Asia/Kolkata", () => {
      expect(bookmarkLocalDay(bookmark("2026-08-10T04:00:00+05:30"))).toBe("2026-08-10");
    });
  });

  it("falls back to the string's date portion when savedAt won't parse", () => {
    expect(bookmarkLocalDay(bookmark("not-a-date-at-all"))).toBe("not-a-date");
  });
});

describe("groupBookmarksByDate", () => {
  it("buckets an IST early-morning save under Today, not Yesterday", () => {
    inTimeZone("Asia/Kolkata", () => {
      // "Now" is 10 Aug 2026, 10:00 local. The bookmark was saved at 04:00
      // local the same morning — 22:30 UTC on the 9th.
      const now = new Date("2026-08-10T04:30:00.000Z"); // 10:00 IST
      const early = bookmark("2026-08-09T22:30:00.000Z"); // 04:00 IST on the 10th
      const groups = groupBookmarksByDate([early], now);
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe("today");
      expect(groups[0].items).toEqual([early]);
    });
  });

  it("still separates a genuinely earlier local day", () => {
    inTimeZone("Asia/Kolkata", () => {
      const now = new Date("2026-08-10T04:30:00.000Z"); // 10:00 IST on the 10th
      const today = bookmark("2026-08-10T03:00:00.000Z"); // 08:30 IST, 10th
      const yesterday = bookmark("2026-08-09T03:00:00.000Z"); // 08:30 IST, 9th
      const groups = groupBookmarksByDate([today, yesterday], now);
      expect(groups.map((g) => g.key)).toEqual(["today", "yesterday"]);
      expect(groups[0].items).toEqual([today]);
      expect(groups[1].items).toEqual([yesterday]);
    });
  });

  it("orders buckets newest → oldest and drops empty ones", () => {
    inTimeZone("UTC", () => {
      // Thursday 6 Aug 2026, 12:00 UTC. Week starts Monday the 3rd.
      const now = new Date("2026-08-06T12:00:00.000Z");
      const groups = groupBookmarksByDate(
        [
          bookmark("2026-08-06T09:00:00.000Z", "today"),
          bookmark("2026-08-04T09:00:00.000Z", "this-week"),
          bookmark("2026-08-01T09:00:00.000Z", "this-month"),
          bookmark("2026-03-01T09:00:00.000Z", "this-year"),
          bookmark("2019-01-01T09:00:00.000Z", "older"),
        ],
        now,
      );
      // No "yesterday" item → that bucket is absent entirely.
      expect(groups.map((g) => g.key)).toEqual(["today", "week", "month", "year", "older"]);
      expect(groups.map((g) => g.label)).toEqual([
        "Today",
        "This week",
        "This month",
        "This year",
        "Older",
      ]);
    });
  });

  it("puts a Monday's own saves in This week, not Older", () => {
    inTimeZone("UTC", () => {
      const now = new Date("2026-08-03T12:00:00.000Z"); // Monday
      const groups = groupBookmarksByDate([bookmark("2026-08-03T01:00:00.000Z")], now);
      expect(groups.map((g) => g.key)).toEqual(["today"]);
    });
  });

  it("returns nothing for an empty list", () => {
    expect(groupBookmarksByDate([])).toEqual([]);
  });
});
