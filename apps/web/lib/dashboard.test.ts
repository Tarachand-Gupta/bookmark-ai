import { describe, expect, it } from "vitest";
import type { Bookmark, DashboardLastSession, LiveDevice, SessionSummary } from "@bookmark-ai/types";
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
  dominantReadingTag,
  liveAgeLabel,
  planTabOpen,
  rankContinueTargets,
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

// ── Web: continue-card ranking ─────────────────────────────────────────────

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

const session: SessionSummary = {
  id: "s1",
  name: "Research",
  tabCount: 6,
  description: null,
  browser: "safari",
  device: "laptop",
  os: "macOS",
  savedAt: "2026-03-05T09:00:00.000Z",
};
const lastSessionTabs: DashboardLastSession = {
  id: "s1",
  tabs: [{ url: "https://a.example/1", title: "one" }],
};

describe("rankContinueTargets", () => {
  it("returns nothing when there is nothing to resume", () => {
    expect(
      rankContinueTargets({
        liveDevices: null,
        lastSessionTabs: null,
        recentSessions: [],
        otherDeviceBookmarks: [],
      }),
    ).toEqual([]);
  });

  it("prefers a fresh live device and keeps only openable http(s) tabs", () => {
    const [winner] = rankContinueTargets({
      liveDevices: [liveDevice()],
      lastSessionTabs,
      recentSessions: [session],
      otherDeviceBookmarks: [bookmark()],
    });
    expect(winner.kind).toBe("live");
    if (winner.kind !== "live") throw new Error("unreachable");
    expect(winner.urls).toEqual(["https://a.example/1"]);
    expect(winner.label).toBe("Active now");
  });

  it("ignores live devices that are stale or empty, falling back to the session", () => {
    const targets = rankContinueTargets({
      liveDevices: [
        liveDevice({ deviceId: "stale", lastSeenAgeSeconds: 48 * 3600 }),
        liveDevice({ deviceId: "empty", tabCount: 0 }),
      ],
      lastSessionTabs,
      recentSessions: [session],
      otherDeviceBookmarks: [],
    });
    expect(targets.map((t) => t.kind)).toEqual(["session"]);
    expect(targets[0].kind === "session" && targets[0].session?.name).toBe("Research");
  });

  it("orders multiple live devices by freshness and caps at two targets", () => {
    const targets = rankContinueTargets({
      liveDevices: [
        liveDevice({ deviceId: "older", lastSeenAgeSeconds: 4000 }),
        liveDevice({ deviceId: "newer", lastSeenAgeSeconds: 60 }),
      ],
      lastSessionTabs,
      recentSessions: [session],
      otherDeviceBookmarks: [bookmark()],
    });
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => (t.kind === "live" ? t.device.deviceId : t.kind))).toEqual([
      "newer",
      "older",
    ]);
  });

  it("breaks a same-bucket freshness tie on tab count, not raw lastSeen", () => {
    // Both checked in within the 5-min bucket, so they're equally "here now" —
    // the busier device is the one the user actually left mid-task.
    const targets = rankContinueTargets({
      liveDevices: [
        liveDevice({ deviceId: "fresher-but-idle", lastSeenAgeSeconds: 10, tabCount: 2 }),
        liveDevice({ deviceId: "busy", lastSeenAgeSeconds: 240, tabCount: 18 }),
      ],
      lastSessionTabs: null,
      recentSessions: [],
      otherDeviceBookmarks: [],
    });
    expect(targets.map((t) => (t.kind === "live" ? t.device.deviceId : t.kind))).toEqual([
      "busy",
      "fresher-but-idle",
    ]);
  });

  it("keeps freshness ahead of tab count across buckets", () => {
    // A device seen 2h ago does not outrank a live one just because it had more
    // tabs open — the tie-break only applies WITHIN a bucket.
    const targets = rankContinueTargets({
      liveDevices: [
        liveDevice({ deviceId: "stale-busy", lastSeenAgeSeconds: 7200, tabCount: 30 }),
        liveDevice({ deviceId: "live-quiet", lastSeenAgeSeconds: 20, tabCount: 1 }),
      ],
      lastSessionTabs: null,
      recentSessions: [],
      otherDeviceBookmarks: [],
    });
    expect(targets.map((t) => (t.kind === "live" ? t.device.deviceId : t.kind))).toEqual([
      "live-quiet",
      "stale-busy",
    ]);
  });

  it("never lets the runner-up be the winner again (duplicate device ids)", () => {
    const targets = rankContinueTargets({
      liveDevices: [liveDevice({ deviceId: "same" }), liveDevice({ deviceId: "same" })],
      lastSessionTabs: null,
      recentSessions: [],
      otherDeviceBookmarks: [],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].kind === "live" && targets[0].device.deviceId).toBe("same");
  });

  it("falls back to other-device bookmarks last", () => {
    const targets = rankContinueTargets({
      liveDevices: [],
      lastSessionTabs: null,
      recentSessions: [],
      otherDeviceBookmarks: [bookmark({ id: "x" })],
    });
    expect(targets.map((t) => t.kind)).toEqual(["bookmarks"]);
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

describe("dominantReadingTag", () => {
  it("picks the tag the items actually carry, defaulting to reading", () => {
    expect(dominantReadingTag([])).toBe("reading");
    expect(dominantReadingTag([{ tags: ["article"] }, { tags: ["article", "dev"] }])).toBe(
      "article",
    );
    expect(dominantReadingTag([{ tags: ["reading"] }, { tags: ["article"] }])).toBe("reading");
    expect(dominantReadingTag([{ tags: ["dev"] }])).toBe("reading");
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
