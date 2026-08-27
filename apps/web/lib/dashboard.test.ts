import { describe, expect, it } from "vitest";
import type { Bookmark, LiveDevice } from "@bookmark-ai/types";
import {
  ACTIVITY_DAYS,
  ACTIVITY_MIN_BOOKMARKS,
  assembleDashboard,
  shiftDay,
  topCategories,
  utcDay,
  zeroFillDays,
  type DashboardParts,
} from "@bookmark-ai/engine";
import {
  hasDashboardActivity,
  isMobilePlatform,
  liveAgeLabel,
  mergeRecentSaves,
  planTabOpen,
  rankLiveDevices,
  relativeTime,
  OPEN_TABS_MAX,
} from "./dashboard";

// ── Engine: day-window maths ────────────────────────────────────────────────

describe("zeroFillDays", () => {
  it("returns exactly the requested window, ascending, ending today", () => {
    const days = zeroFillDays([], { today: "2026-03-05", days: 14 });
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe("2026-02-20");
    expect(days[13].day).toBe("2026-03-05");
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  it("fills gaps with zeros and keeps real counts", () => {
    const days = zeroFillDays(
      [
        { day: "2026-03-03", count: 4 },
        { day: "2026-03-05", count: 1 },
      ],
      { today: "2026-03-05", days: 4 },
    );
    expect(days).toEqual([
      { day: "2026-03-02", count: 0 },
      { day: "2026-03-03", count: 4 },
      { day: "2026-03-04", count: 0 },
      { day: "2026-03-05", count: 1 },
    ]);
  });

  it("ignores rows outside the window", () => {
    const days = zeroFillDays([{ day: "2025-12-31", count: 99 }], {
      today: "2026-01-02",
      days: 2,
    });
    expect(days).toEqual([
      { day: "2026-01-01", count: 0 },
      { day: "2026-01-02", count: 0 },
    ]);
  });

  it("crosses month and year boundaries", () => {
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(utcDay(new Date("2026-08-10T23:30:00.000Z"))).toBe("2026-08-10");
  });
});

describe("topCategories", () => {
  it("drops Uncategorized and keeps the top three", () => {
    expect(
      topCategories([
        { name: "Uncategorized", count: 50 },
        { name: "Dev", count: 9 },
        { name: "News", count: 4 },
        { name: "Design", count: 2 },
        { name: "Food", count: 1 },
      ]),
    ).toEqual([
      { name: "Dev", count: 9 },
      { name: "News", count: 4 },
      { name: "Design", count: 2 },
    ]);
  });

  it("matches Uncategorized case-insensitively", () => {
    expect(topCategories([{ name: "uncategorized", count: 3 }])).toEqual([]);
  });
});

// ── Engine: response assembly ──────────────────────────────────────────────

function parts(overrides: Partial<DashboardParts> = {}): DashboardParts {
  return {
    recentBookmarks: [],
    readingQueue: { total: 0, items: [] },
    recentSessions: [],
    lastSessionTabs: null,
    otherDeviceBookmarks: [],
    activityCounts: { days: [], categories: [], browsers: [] },
    totalBookmarks: 0,
    totalSessions: 0,
    ...overrides,
  };
}

describe("assembleDashboard", () => {
  it("suppresses activity below the small-N floor", () => {
    const res = assembleDashboard(
      parts({ totalBookmarks: ACTIVITY_MIN_BOOKMARKS - 1 }),
      { today: "2026-03-05" },
    );
    expect(res.activity).toBeNull();
    expect(res.totalBookmarks).toBe(ACTIVITY_MIN_BOOKMARKS - 1);
  });

  it("builds activity at/above the floor with a full zero-filled window", () => {
    const res = assembleDashboard(
      parts({
        totalBookmarks: ACTIVITY_MIN_BOOKMARKS,
        activityCounts: {
          days: [{ day: "2026-03-05", count: 3 }],
          categories: [
            { name: "Uncategorized", count: 10 },
            { name: "Dev", count: 7 },
          ],
          browsers: [
            { name: "chrome", count: 12 },
            { name: "safari", count: 8 },
          ],
        },
      }),
      { today: "2026-03-05" },
    );
    expect(res.activity).not.toBeNull();
    expect(res.activity!.days).toHaveLength(ACTIVITY_DAYS);
    expect(res.activity!.days.at(-1)).toEqual({ day: "2026-03-05", count: 3 });
    expect(res.activity!.topCategories).toEqual([{ name: "Dev", count: 7 }]);
    expect(res.activity!.browserSplit).toHaveLength(2);
  });

  it("anchors the window on the latest saved_day when a client is ahead of UTC", () => {
    // saved_day comes from the client's own offset-bearing timestamp, so a user
    // at +05:30 can produce "tomorrow" relative to the server's UTC date. Those
    // saves must still be the last bar, not fall off the end.
    const res = assembleDashboard(
      parts({
        totalBookmarks: ACTIVITY_MIN_BOOKMARKS,
        activityCounts: {
          days: [{ day: "2026-03-06", count: 2 }],
          categories: [],
          browsers: [],
        },
      }),
      { today: "2026-03-05" },
    );
    expect(res.activity!.days).toHaveLength(ACTIVITY_DAYS);
    expect(res.activity!.days.at(-1)).toEqual({ day: "2026-03-06", count: 2 });
  });

  it("passes the fetched lists through untouched (no re-sorting/trimming)", () => {
    const items = [bookmark({ id: "a" }), bookmark({ id: "b" })];
    const res = assembleDashboard(
      parts({
        recentBookmarks: items,
        readingQueue: { total: 42, items: [items[0]] },
        otherDeviceBookmarks: [items[1]],
        totalSessions: 3,
      }),
      { today: "2026-03-05" },
    );
    expect(res.recentBookmarks.map((b) => b.id)).toEqual(["a", "b"]);
    expect(res.readingQueue).toEqual({ total: 42, items: [items[0]] });
    expect(res.otherDeviceBookmarks.map((b) => b.id)).toEqual(["b"]);
    expect(res.totalSessions).toBe(3);
  });
});

// ── Web: dashboard card inputs ─────────────────────────────────────────────

function bookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "b1",
    url: "https://example.com/a",
    domain: "example.com",
    title: "A page",
    description: null,
    og: {},
    source: {
      browser: "chrome",
      device: "laptop",
      deviceName: null,
      os: "macOS",
      savedAt: "2026-03-05T10:00:00.000Z",
    },
    category: "Dev",
    tags: [],
    createdAt: "2026-03-05T10:00:00.000Z",
    embedded: true,
    ...over,
  };
}

function liveDevice(over: Partial<LiveDevice> = {}): LiveDevice {
  return {
    deviceId: "d1",
    label: "MacBook",
    browser: "chrome",
    device: "laptop",
    os: "macOS",
    windows: [
      {
        windowId: 1,
        tabs: [
          { url: "https://a.example/1", title: "one" },
          { url: "chrome://newtab", title: "internal" },
          { url: "https://b.example/2", title: "two", redacted: true },
        ],
      },
    ],
    tabCount: 3,
    hiddenTabCount: 0,
    lastSeenAt: "2026-03-05T10:00:00.000Z",
    lastSeenAgeSeconds: 30,
    ...over,
  };
}

describe("rankLiveDevices", () => {
  it("is empty when live is off or unreachable", () => {
    expect(rankLiveDevices(null)).toEqual([]);
    expect(rankLiveDevices([])).toEqual([]);
  });

  it("drops devices that are stale or have nothing open", () => {
    expect(
      rankLiveDevices([
        liveDevice({ deviceId: "stale", lastSeenAgeSeconds: 48 * 3600 }),
        liveDevice({ deviceId: "empty", tabCount: 0 }),
        liveDevice({ deviceId: "here" }),
      ]).map((d) => d.deviceId),
    ).toEqual(["here"]);
  });

  it("orders multiple live devices by freshness", () => {
    expect(
      rankLiveDevices([
        liveDevice({ deviceId: "older", lastSeenAgeSeconds: 4000 }),
        liveDevice({ deviceId: "newer", lastSeenAgeSeconds: 60 }),
      ]).map((d) => d.deviceId),
    ).toEqual(["newer", "older"]);
  });

  it("breaks a same-bucket freshness tie on tab count, not raw lastSeen", () => {
    // Both checked in within the 5-min bucket, so they're equally "here now" —
    // the busier device is the one the user actually left mid-task.
    expect(
      rankLiveDevices([
        liveDevice({ deviceId: "fresher-but-idle", lastSeenAgeSeconds: 10, tabCount: 2 }),
        liveDevice({ deviceId: "busy", lastSeenAgeSeconds: 240, tabCount: 18 }),
      ]).map((d) => d.deviceId),
    ).toEqual(["busy", "fresher-but-idle"]);
  });

  it("keeps freshness ahead of tab count across buckets", () => {
    // A device seen 2h ago does not outrank a live one just because it had more
    // tabs open — the tie-break only applies WITHIN a bucket.
    expect(
      rankLiveDevices([
        liveDevice({ deviceId: "stale-busy", lastSeenAgeSeconds: 7200, tabCount: 30 }),
        liveDevice({ deviceId: "live-quiet", lastSeenAgeSeconds: 20, tabCount: 1 }),
      ]).map((d) => d.deviceId),
    ).toEqual(["live-quiet", "stale-busy"]);
  });

  it("never lists the same device twice (a re-announcing device)", () => {
    const rows = rankLiveDevices([
      liveDevice({ deviceId: "same" }),
      liveDevice({ deviceId: "same" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].deviceId).toBe("same");
  });
});

describe("mergeRecentSaves", () => {
  const at = (id: string, savedAt: string) =>
    bookmark({ id, source: { ...bookmark().source, savedAt } });

  it("interleaves cross-device saves newest-first", () => {
    expect(
      mergeRecentSaves(
        [at("a", "2026-03-05T10:00:00.000Z"), at("c", "2026-03-05T08:00:00.000Z")],
        [at("b", "2026-03-05T09:00:00.000Z")],
        5,
      ).map((b) => b.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("lists a bookmark present in both lists exactly once", () => {
    // otherDeviceBookmarks is a filtered slice of the same table, so overlap is
    // the normal case — a save must never show up as two rows.
    expect(
      mergeRecentSaves([at("a", "2026-03-05T10:00:00.000Z")], [at("a", "2026-03-05T10:00:00.000Z")], 5)
        .length,
    ).toBe(1);
  });

  it("caps the list at the row limit", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      at(`b${i}`, `2026-03-0${(i % 9) + 1}T10:00:00.000Z`),
    );
    expect(mergeRecentSaves(many, [], 5)).toHaveLength(5);
  });

  it("sorts unparseable timestamps last instead of scrambling the list", () => {
    expect(
      mergeRecentSaves(
        [at("broken", "not a date"), at("real", "2026-03-05T10:00:00.000Z")],
        [],
        5,
      ).map((b) => b.id),
    ).toEqual(["real", "broken"]);
  });
});

describe("liveAgeLabel", () => {
  it("labels honestly across the buckets", () => {
    expect(liveAgeLabel(5)).toBe("Active now");
    expect(liveAgeLabel(1200)).toBe("Active 20 min ago");
    expect(liveAgeLabel(7200)).toBe("Active 2 hours ago");
    expect(liveAgeLabel(10 * 3600)).toBe("Earlier today");
    expect(liveAgeLabel(50 * 3600)).toBe("2 days ago");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-03-05T12:00:00.000Z");
  it("shortens recent times and dates older ones", () => {
    expect(relativeTime("2026-03-05T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-03-05T11:30:00.000Z", now)).toBe("30m ago");
    expect(relativeTime("2026-03-05T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-03-02T12:00:00.000Z", now)).toBe("3d ago");
    expect(relativeTime("2026-01-02T12:00:00.000Z", now)).not.toMatch(/ago/);
  });

  it("is blank for unparseable input", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("hasDashboardActivity", () => {
  // The Activity card is the ONE card allowed to be absent rather than empty
  // (docs/features/dashboard.md §3.2, Tara 2026-08-27), so the rule that decides
  // it is tested rather than eyeballed.
  const activity = (days: number[]) => ({
    days: days.map((count, i) => ({ day: `2026-03-${String(i + 1).padStart(2, "0")}`, count })),
    topCategories: [{ name: "Dev", count: 9 }],
    browserSplit: [{ name: "chrome", count: 12 }],
  });

  it("is false when the server suppressed activity entirely", () => {
    expect(hasDashboardActivity(null)).toBe(false);
    expect(hasDashboardActivity(undefined)).toBe(false);
  });

  it("is false for a fully zero-filled window", () => {
    // Above ACTIVITY_MIN_BOOKMARKS the server still sends 14 zero buckets when
    // every save is older than the window — a sparkline of nothing.
    expect(hasDashboardActivity(activity(Array.from({ length: 14 }, () => 0)))).toBe(false);
  });

  it("is false when only the all-time facets have data", () => {
    // topCategories/browserSplit are all-time, so they survive an empty window —
    // and a card whose headline chart is blank does not earn a grid slot for its
    // footnotes.
    expect(
      hasDashboardActivity({
        days: [{ day: "2026-03-05", count: 0 }],
        topCategories: [{ name: "Dev", count: 40 }],
        browserSplit: [{ name: "chrome", count: 40 }],
      }),
    ).toBe(false);
  });

  it("is true as soon as ONE day in the window has a save", () => {
    const days = Array.from({ length: 14 }, () => 0);
    days[0] = 1; // oldest bucket — still inside the window
    expect(hasDashboardActivity(activity(days))).toBe(true);
    expect(hasDashboardActivity(activity([0, 0, 3]))).toBe(true);
  });

  it("is false for an empty days array", () => {
    expect(hasDashboardActivity(activity([]))).toBe(false);
  });
});

describe("isMobilePlatform", () => {
  const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const SAFARI_IPAD_DESKTOP_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const CHROME_ANDROID_TABLET =
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

  it("says no when there is no navigator at all (SSR)", () => {
    expect(isMobilePlatform(null)).toBe(false);
    expect(isMobilePlatform(undefined)).toBe(false);
    expect(isMobilePlatform({})).toBe(false);
  });

  it("trusts a positive userAgentData.mobile", () => {
    expect(isMobilePlatform({ userAgent: "anything", userAgentData: { mobile: true } })).toBe(true);
  });

  it("treats a desktop browser as desktop", () => {
    expect(
      isMobilePlatform({
        userAgent: CHROME_MAC,
        maxTouchPoints: 0,
        userAgentData: { mobile: false },
      }),
    ).toBe(false);
  });

  it("catches phones from the user agent", () => {
    expect(isMobilePlatform({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5 })).toBe(true);
  });

  it("catches iPadOS asking for the desktop site", () => {
    // iPadOS reports a Macintosh UA with no iPad token; maxTouchPoints is the
    // only tell, and a real Mac reports 0.
    expect(isMobilePlatform({ userAgent: SAFARI_IPAD_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isMobilePlatform({ userAgent: SAFARI_IPAD_DESKTOP_UA, maxTouchPoints: 0 })).toBe(false);
  });

  it("does not mistake a touchscreen Windows laptop for a tablet", () => {
    expect(
      isMobilePlatform({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        maxTouchPoints: 10,
      }),
    ).toBe(false);
  });

  it("calls an Android tablet mobile even though userAgentData.mobile is false", () => {
    // Chrome on Android has no extensions at all, so a false here must NOT be
    // taken as "desktop, offer the store button".
    expect(
      isMobilePlatform({
        userAgent: CHROME_ANDROID_TABLET,
        maxTouchPoints: 5,
        userAgentData: { mobile: false },
      }),
    ).toBe(true);
  });
});

describe("planTabOpen", () => {
  const many = Array.from({ length: 14 }, (_, i) => `https://x.example/${i}`);

  it("drops non-http(s) URLs", () => {
    expect(planTabOpen(["https://ok.example", "javascript:alert(1)", "chrome://x"]).urls).toEqual([
      "https://ok.example",
    ]);
  });

  it("caps the batch and reports what it skipped", () => {
    const plan = planTabOpen(many);
    expect(plan.urls).toHaveLength(OPEN_TABS_MAX);
    expect(plan.skipped).toBe(many.length - OPEN_TABS_MAX);
    expect(plan.needsConfirm).toBe(true);
  });

  it("does not ask for confirmation on a small batch", () => {
    const plan = planTabOpen(many.slice(0, 4));
    expect(plan.needsConfirm).toBe(false);
    expect(plan.skipped).toBe(0);
  });
});
