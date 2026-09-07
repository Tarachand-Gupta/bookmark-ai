import { describe, expect, it } from "vitest";
import {
  cellText,
  filterByText,
  filterSessions,
  flattenLiveDevices,
  foldState,
  hostOf,
  matchesText,
  nextFoldShown,
  pageFooterVisible,
  pageLiveSnapshot,
  pageSearchResponse,
  pageSessionsSnapshot,
  regroupLiveTabs,
  safeHttpUrl,
  showMoreLabel,
  type LiveDeviceHit,
} from "@bookmark-ai/types";

/**
 * The card logic every client shares (packages/types/src/chat-tool-cards.ts):
 * folding, filtering, live-tab flatten/regroup and the client-side pagers.
 * The Swift port (apps/macos/Tests/ChatToolCardTests.swift) asserts the same
 * cases, so a behaviour change here must land there too.
 */

describe("foldState / nextFoldShown", () => {
  it("collapses past the threshold and reveals in chunks", () => {
    expect(foldState(4, 10)).toEqual({ visibleCount: 4, hidden: 0, expanded: false, nextChunk: 0 });
    expect(foldState(92, 10)).toEqual({ visibleCount: 10, hidden: 82, expanded: false, nextChunk: 25 });
    expect(nextFoldShown(92, 10)).toBe(35);
    expect(foldState(92, 35)).toEqual({ visibleCount: 35, hidden: 57, expanded: true, nextChunk: 25 });
    expect(nextFoldShown(92, 85)).toBe(92);
    // Everything showing → the next click snaps back to the collapsed size.
    expect(foldState(92, 92).hidden).toBe(0);
    expect(nextFoldShown(92, 92)).toBe(10);
  });

  it("never shows more than exist", () => {
    expect(foldState(3, 10).visibleCount).toBe(3);
    expect(foldState(0, 10)).toEqual({ visibleCount: 0, hidden: 0, expanded: false, nextChunk: 0 });
  });
});

describe("showMoreLabel", () => {
  it("names the chunk, the remainder, and the noun", () => {
    expect(showMoreLabel(82, 25, "tab")).toBe("Show 25 more (82 left)");
    expect(showMoreLabel(7, 25, "tab")).toBe("Show 7 more tabs");
    expect(showMoreLabel(1, 25, "row")).toBe("Show 1 more row");
    expect(showMoreLabel(0, 0, "row")).toBe("Show less");
    expect(showMoreLabel(5, undefined, "result")).toBe("Show 5 more results");
  });
});

describe("filterByText / matchesText", () => {
  const items = ["Next.js Docs", "Turso — SQLite", "Deploy on DigitalOcean"];
  it("is a trimmed, case-insensitive substring match", () => {
    expect(filterByText(items, (s) => s, "  sqlite ")).toEqual(["Turso — SQLite"]);
    expect(filterByText(items, (s) => s, "")).toEqual(items);
    expect(filterByText(items, (s) => s, "zzz")).toEqual([]);
    expect(matchesText("ocean", "Deploy", "https://digitalocean.com")).toBe(true);
    expect(matchesText(undefined, "anything")).toBe(true);
    expect(matchesText("x", null, undefined)).toBe(false);
  });
});

describe("formatters", () => {
  it("hostOf strips www and survives garbage", () => {
    expect(hostOf("https://www.example.com/a/b?c")).toBe("example.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
  it("safeHttpUrl only passes http(s)", () => {
    expect(safeHttpUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("chrome://settings")).toBeUndefined();
  });
  it("cellText renders null as empty and objects as JSON", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText(3.5)).toBe("3.5");
  });
  it("pageFooterVisible hides the footer for a whole, first, clean result", () => {
    const page = { total: 8, offset: 0, limit: 50, hasMore: false, nextOffset: null };
    expect(pageFooterVisible(page, 0, null)).toBe(false);
    expect(pageFooterVisible({ ...page, hasMore: true, nextOffset: 50 }, 0, null)).toBe(true);
    expect(pageFooterVisible(page, 50, null)).toBe(true);
    expect(pageFooterVisible(page, 0, "boom")).toBe(true);
    expect(pageFooterVisible(undefined, 0, null)).toBe(false);
  });
});

const devices: LiveDeviceHit[] = [
  {
    label: "MacBook",
    browser: "chrome",
    lastSeenAgeSeconds: 5,
    tabCount: 23,
    hiddenTabCount: 3,
    windows: [
      { windowId: 1, name: "Work", index: 1, windowTabCount: 13, tabs: [{ title: "A", url: "https://a.dev" }, { title: "B", url: "https://b.dev" }] },
      { windowId: 2, name: null, index: 2, windowTabCount: 10, tabs: [{ title: "C", url: "https://c.dev" }] },
    ],
  },
  {
    label: "iPhone",
    browser: "safari",
    lastSeenAgeSeconds: 700,
    tabCount: 8,
    hiddenTabCount: 0,
    windows: [{ windowId: 1, index: 1, windowTabCount: 8, tabs: [{ title: "D", url: "https://d.dev" }] }],
  },
];

describe("flattenLiveDevices / regroupLiveTabs", () => {
  it("round-trips device → window → tab in order, keeping full counts", () => {
    const flat = flattenLiveDevices(devices);
    expect(flat.map((f) => f.tab.title)).toEqual(["A", "B", "C", "D"]);
    expect(flat[0]).toMatchObject({ windowId: 1, windowName: "Work", windowIndex: 1, windowTabCount: 13 });
    const grouped = regroupLiveTabs(flat);
    expect(grouped.map((d) => d.label)).toEqual(["MacBook", "iPhone"]);
    expect(grouped[0].loadedTabCount).toBe(3);
    expect(grouped[0].tabCount).toBe(23);
    expect(grouped[0].windows.map((w) => w.tabs.length)).toEqual([2, 1]);
    expect(grouped[0].windows[0]).toMatchObject({ windowId: 1, name: "Work", windowTabCount: 13 });
  });

  it("regroups a filtered subset without inventing empty groups", () => {
    const flat = flattenLiveDevices(devices).filter((f) => f.tab.title !== "A" && f.tab.title !== "B");
    const grouped = regroupLiveTabs(flat);
    expect(grouped[0].windows.map((w) => w.windowId)).toEqual([2]);
    expect(grouped[0].loadedTabCount).toBe(1);
  });

  it("keys windows by windowId, falling back to the display index", () => {
    const grouped = regroupLiveTabs(
      flattenLiveDevices([
        { ...devices[1], windows: [{ index: 1, tabs: [{ title: "x", url: "u" }] }, { index: 2, tabs: [{ title: "y", url: "v" }] }] },
      ]),
    );
    expect(grouped[0].windows).toHaveLength(2);
  });
});

describe("pageLiveSnapshot", () => {
  const live = {
    devices: [
      {
        label: "MacBook",
        browser: "chrome",
        lastSeenAgeSeconds: 3,
        tabCount: 4,
        hiddenTabCount: 1,
        windows: [
          { windowId: 7, name: "Work", tabs: [
            { title: "Next.js Docs", url: "https://nextjs.org/docs", favIconUrl: "https://nextjs.org/favicon.ico" },
            { title: "", url: "https://digitalocean.com/tutorials" },
          ] },
          { windowId: 8, tabs: [{ title: "Turso", url: "https://turso.tech" }, { title: "Zig", url: "https://ziglang.org" }] },
        ],
      },
    ],
  };

  it("flattens, filters with the tool's query, and slices a page with full window counts", () => {
    const all = pageLiveSnapshot(live, undefined, 0, 50);
    expect(all.rows.map((r) => r.tab.title)).toEqual(["Next.js Docs", "", "Turso", "Zig"]);
    expect(all.page).toEqual({ total: 4, offset: 0, limit: 50, hasMore: false, nextOffset: null });
    expect(all.rows[0]).toMatchObject({ windowId: 7, windowName: "Work", windowIndex: 1, windowTabCount: 2 });
    expect(all.rows[0].tab.favIconUrl).toBe("https://nextjs.org/favicon.ico");
    expect(all.rows[1].tab.favIconUrl).toBeNull();

    const second = pageLiveSnapshot(live, undefined, 2, 2);
    expect(second.rows.map((r) => r.tab.title)).toEqual(["Turso", "Zig"]);
    expect(second.page).toEqual({ total: 4, offset: 2, limit: 2, hasMore: false, nextOffset: null });

    const filtered = pageLiveSnapshot(live, "ocean", 0, 50);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].tab.url).toContain("digitalocean");
  });
});

describe("sessions pager", () => {
  const all = [
    { id: "s1", name: "Japan trip", description: "Kyoto and Osaka", tabCount: 20, browser: "safari", savedAt: "2026-09-01T00:00:00Z", tabs: Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, url: `https://t${i}.jp` })) },
    { id: "s2", name: "Rust reading", description: null, tabCount: 2, browser: "chrome", savedAt: "2026-08-01T00:00:00Z", tabs: [{ title: "Tokio", url: "https://tokio.rs" }, { title: null, url: "https://doc.rust-lang.org" }] },
    { id: "s3", name: "Misc", tabCount: 1, browser: "firefox", savedAt: "2026-07-01T00:00:00Z", tabs: [{ title: "DigitalOcean", url: "https://digitalocean.com" }] },
  ];

  it("filters like the tool (name, description, tab title/url) and clips tabs to 15", () => {
    expect(filterSessions(all, "osaka").map((s) => s.id)).toEqual(["s1"]);
    expect(filterSessions(all, "rust-lang").map((s) => s.id)).toEqual(["s2"]);
    expect(filterSessions(all, "").map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    const page = pageSessionsSnapshot(all, undefined, 0, 50);
    expect(page.rows[0].tabs).toHaveLength(15);
    expect(page.rows[1].tabs[1]).toEqual({ title: "", url: "https://doc.rust-lang.org" });
    expect(page.rows[1].description).toBeNull();
    expect(page.page).toEqual({ total: 3, offset: 0, limit: 50, hasMore: false, nextOffset: null });
  });

  it("pages the filtered list from the tool's offset", () => {
    const page = pageSessionsSnapshot(all, undefined, 1, 1);
    expect(page.rows.map((s) => s.id)).toEqual(["s2"]);
    expect(page.page).toEqual({ total: 3, offset: 1, limit: 1, hasMore: true, nextOffset: 2 });
  });
});

describe("pageSearchResponse", () => {
  it("maps hits and lets hasMore drive the next page (total unknown)", () => {
    const results = [
      { score: 0.9, bookmark: { id: "b1", title: "T", url: "https://t.dev", category: "Dev", tags: ["a", "b"], source: { savedAt: "2026-09-07T10:00:00.000Z" } } },
    ];
    expect(pageSearchResponse(results, true, 50, 50)).toEqual({
      rows: [{ id: "b1", title: "T", url: "https://t.dev", category: "Dev", tags: ["a", "b"], day: "2026-09-07", score: 0.9 }],
      page: { total: null, offset: 50, limit: 50, hasMore: true, nextOffset: 100 },
    });
    expect(pageSearchResponse(results, undefined, 0, 50).page.nextOffset).toBeNull();
  });
});
