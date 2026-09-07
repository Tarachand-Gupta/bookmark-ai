import { describe, expect, it } from "vitest";
import {
  clampText,
  MAX_SUMMARY_CHARS,
  MODEL_GROUP_LIMIT,
  summarizeBookmarkSearch,
  summarizeLiveTabs,
  summarizeSessions,
  summarizeSqlResult,
} from "./chat-tool-summary";

const tab = (i: number) => ({ title: `Tab ${i}`, url: `https://example.com/${i}` });

describe("clampText", () => {
  it("trims and ellipsizes past the cap", () => {
    expect(clampText("  hi  ", 10)).toBe("hi");
    expect(clampText("abcdefghij", 5)).toBe("abcd…");
    expect(clampText(null, 5)).toBe("");
    expect(clampText(42, 5)).toBe("42");
  });
});

describe("summarizeLiveTabs", () => {
  const big = {
    enabled: true,
    devices: [
      {
        label: "MacBook",
        browser: "chrome",
        lastSeenAgeSeconds: 12,
        tabCount: 60,
        hiddenTabCount: 0,
        windows: [{ windowId: 1, tabs: Array.from({ length: 60 }, (_, i) => tab(i)) }],
      },
      {
        label: "Pixel",
        browser: "chrome",
        lastSeenAgeSeconds: 300,
        tabCount: 32,
        hiddenTabCount: 2,
        windows: [{ windowId: 2, tabs: Array.from({ length: 32 }, (_, i) => tab(100 + i)) }],
      },
    ],
  };

  it("gives counts up front and only the first N tabs per device", () => {
    const out = summarizeLiveTabs(big);
    expect(out).toContain("92 open tabs across 2 devices");
    expect(out).toContain("Tab 0");
    expect(out).toContain(`Tab ${MODEL_GROUP_LIMIT - 1}`);
    expect(out).not.toContain(`Tab ${MODEL_GROUP_LIMIT}\n`);
    expect(out).toContain("45 more tabs not listed here");
    expect(out).toContain("17 more tabs not listed here");
    expect(out).toContain("interactive card");
  });

  it("is far shorter than the raw JSON", () => {
    expect(summarizeLiveTabs(big).length).toBeLessThan(JSON.stringify(big).length / 2);
    expect(summarizeLiveTabs(big).length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("passes through the off / error / empty shapes", () => {
    expect(summarizeLiveTabs({ enabled: false, devices: [] })).toContain("OFF");
    expect(summarizeLiveTabs({ error: "live server down" })).toContain("live server down");
    expect(summarizeLiveTabs({ enabled: true, devices: [] })).toContain("no device is sharing");
  });
});

describe("summarizeBookmarkSearch", () => {
  it("caps the listed hits and names the rest as a count", () => {
    const out = summarizeBookmarkSearch({
      mode: "hybrid",
      results: Array.from({ length: 40 }, (_, i) => ({
        title: `Bookmark ${i}`,
        url: `https://ex.com/${i}`,
        category: "Dev",
        day: "2026-09-01",
      })),
    });
    expect(out).toContain("40 matching bookmarks");
    expect(out).toContain("Bookmark 0");
    expect(out).toContain("25 more results not listed here");
    expect(out).not.toContain("Bookmark 39");
  });

  it("says so plainly on an empty result and passes errors through", () => {
    expect(summarizeBookmarkSearch({ results: [] })).toContain("No bookmarks matched");
    expect(summarizeBookmarkSearch({ error: "boom" })).toContain("boom");
  });
});

describe("summarizeSessions", () => {
  it("lists sessions with a handful of tabs each", () => {
    const out = summarizeSessions({
      total: 3,
      sessions: [
        { name: "Rust reading", tabCount: 12, browser: "firefox", savedAt: "2026-09-01T10:00:00Z", tabs: Array.from({ length: 12 }, (_, i) => tab(i)) },
      ],
    });
    expect(out).toContain("3 saved sessions");
    expect(out).toContain('"Rust reading" — 12 tabs');
    expect(out).toContain("7 more tabs in this session");
  });
});

describe("summarizeSqlResult", () => {
  it("renders a pipe table capped at 20 rows", () => {
    const out = summarizeSqlResult({
      columns: ["category", "n"],
      rows: Array.from({ length: 30 }, (_, i) => [`cat${i}`, i]),
      rowCount: 30,
    });
    expect(out).toContain("30 rows");
    expect(out).toContain("category | n");
    expect(out).toContain("cat0 | 0");
    expect(out).toContain("10 more rows not listed here");
    expect(out).not.toContain("cat29");
  });

  it("handles 0 rows and errors", () => {
    expect(summarizeSqlResult({ columns: ["a"], rows: [] })).toBe("0 rows.");
    expect(summarizeSqlResult({ error: "no such column: x" })).toContain("no such column");
  });
});
