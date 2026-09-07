import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beyondPayload,
  beyondPayloadNote,
  bookmarkSubtitle,
  carrySqlTotal,
  countSummary,
  deviceTabsLabel,
  faviconInitial,
  hiddenTabsNote,
  isRenderableFavicon,
  liveTabsNote,
  liveTabsSummary,
  openableUrl,
  scoreLabel,
  sessionMeta,
  sessionsSummary,
  showFilter,
  showScores,
  sqlCardState,
  sqlColumnWidths,
  visibleTags,
  windowTabsLabel,
  windowTitle,
} from "./chatCards";

describe("showFilter", () => {
  it("shows the box past the row threshold, sessions past a lower one", () => {
    assert.equal(showFilter(6), false);
    assert.equal(showFilter(7), true);
    assert.equal(showFilter(4, 4), false);
    assert.equal(showFilter(5, 4), true);
  });
});

describe("summaries", () => {
  it("countSummary reads the filter count or the plural noun", () => {
    assert.equal(countSummary(true, 3, 12, "result"), "3 of 12");
    assert.equal(countSummary(false, 3, 12, "result"), "12 results");
    assert.equal(countSummary(false, 1, 1, "row"), "1 row");
  });
  it("liveTabsSummary prefers the tool's total over what's loaded", () => {
    assert.equal(liveTabsSummary(false, 31, 31, 92, 2), "92 tabs · 2 devices");
    assert.equal(liveTabsSummary(false, 5, 5, null, 1), "5 tabs · 1 device");
    assert.equal(liveTabsSummary(true, 4, 31, 92, 2), "4 of 31");
  });
  it("sessionsSummary", () => {
    assert.equal(sessionsSummary(false, 5, 5, 7), "7 sessions");
    assert.equal(sessionsSummary(false, 1, 1, undefined), "1 session");
    assert.equal(sessionsSummary(true, 2, 5, 7), "2 of 5");
  });
});

describe("live tab labels", () => {
  it("deviceTabsLabel says N of M when partially loaded, with the server age", () => {
    assert.equal(deviceTabsLabel(13, 31, 5), "13 of 31 tabs · as of just now");
    assert.equal(deviceTabsLabel(31, 31, 120), "31 tabs · as of 2 min ago");
    assert.equal(deviceTabsLabel(1, 1, 7200), "1 tab · as of 2 hours ago");
  });
  it("windowTabsLabel and windowTitle", () => {
    assert.equal(windowTabsLabel(10, 34), "10 of 34 tabs");
    assert.equal(windowTabsLabel(34, 34), "34 tabs");
    assert.equal(windowTitle("Work", 2), "Work");
    assert.equal(windowTitle("  ", 2), "Window 2");
    assert.equal(windowTitle(null, 1), "Window 1");
  });
  it("hiddenTabsNote agrees in number", () => {
    assert.equal(hiddenTabsNote(0), null);
    assert.equal(hiddenTabsNote(1), "1 tab on this device is in windows that aren’t shared to live sessions");
    assert.equal(hiddenTabsNote(3), "3 tabs on this device are in windows that aren’t shared to live sessions");
  });
  it("liveTabsNote covers the off / error / empty shapes and is null with data", () => {
    assert.match(liveTabsNote({ error: "down" }, 0)!, /unavailable/);
    assert.match(liveTabsNote({ enabled: false }, 0)!, /Live sharing is off/);
    assert.equal(liveTabsNote({ enabled: true, query: "digitalocean" }, 0), "No open tab matches “digitalocean”.");
    assert.equal(liveTabsNote({ enabled: true }, 0), "No devices are sharing live tabs right now.");
    assert.equal(liveTabsNote({ enabled: true }, 12), null);
  });
});

describe("bookmarks", () => {
  it("bookmarkSubtitle joins the bare host and the day", () => {
    assert.equal(bookmarkSubtitle("https://www.rust-lang.org/learn", "2026-08-30"), "rust-lang.org · 2026-08-30");
    assert.equal(bookmarkSubtitle("https://example.com/x", undefined), "example.com");
  });
  it("scores show only for semantic search", () => {
    assert.equal(scoreLabel(0.874), "87% match");
    assert.equal(showScores("ai"), true);
    assert.equal(showScores("hybrid"), false);
    assert.equal(showScores(undefined), false);
  });
  it("visibleTags caps at four", () => {
    assert.deepEqual(visibleTags(["a", "b", "c", "d", "e"]), ["a", "b", "c", "d"]);
    assert.deepEqual(visibleTags(undefined), []);
  });
});

describe("sessions", () => {
  it("sessionMeta and the beyond-payload count", () => {
    assert.equal(sessionMeta("chrome", 12), "Chrome · 12 tabs");
    assert.equal(sessionMeta("safari", 1), "Safari · 1 tab");
    assert.equal(sessionMeta("", 2), "Browser · 2 tabs");
    assert.equal(beyondPayload(40, 15), 25);
    assert.equal(beyondPayload(10, 10), 0);
    assert.equal(beyondPayload(undefined, 3), 0);
    assert.equal(beyondPayloadNote(25), "+25 more in the session");
    assert.equal(beyondPayloadNote(0), null);
  });
});

describe("sql", () => {
  it("sqlCardState shows the statement even without output", () => {
    assert.deepEqual(sqlCardState({ sql: " SELECT 1 " }, undefined), { sql: "SELECT 1", table: null });
    assert.deepEqual(sqlCardState(undefined, undefined), { sql: "", table: null });
    assert.deepEqual(sqlCardState({ sql: "SELECT 1" }, { error: "nope" }), { sql: "SELECT 1", table: null });
  });
  it("sqlCardState exposes the table once columns and rows settle", () => {
    const state = sqlCardState({ sql: "SELECT a" }, { columns: ["a"], rows: [[1], [2]] });
    assert.deepEqual(state.table, { columns: ["a"], rows: [[1], [2]] });
  });
  it("carrySqlTotal keeps the first page's total because /api/query never recounts", () => {
    const first = { total: 137, offset: 0, limit: 50, hasMore: true, nextOffset: 50 };
    const next = { total: null, offset: 50, limit: 50, hasMore: true, nextOffset: 100 };
    assert.deepEqual(carrySqlTotal(next, first), { ...next, total: 137 });
    assert.deepEqual(carrySqlTotal(next, undefined), { ...next, total: null });
  });
});

describe("sqlColumnWidths", () => {
  it("sizes each column from its longest text, header included, within bounds", () => {
    const widths = sqlColumnWidths(["category", "n"], [["Docs & Reference", 12], ["AI", 8]]);
    assert.equal(widths.length, 2);
    assert.equal(widths[0], Math.ceil("Docs & Reference".length * 7.4 + 20));
    assert.equal(widths[1], 72);
  });
  it("clamps a very long cell to the max width and an empty column to the min", () => {
    const widths = sqlColumnWidths(["url", ""], [["https://example.com/" + "x".repeat(200), null]]);
    assert.deepEqual(widths, [200, 72]);
  });
});

describe("favicons and links", () => {
  it("only http(s) and data:image favicons reach the image loader", () => {
    assert.equal(isRenderableFavicon("https://a.com/favicon.ico"), true);
    assert.equal(isRenderableFavicon("data:image/png;base64,AA=="), true);
    assert.equal(isRenderableFavicon("chrome://favicon/x"), false);
    assert.equal(isRenderableFavicon("moz-extension://abc/icon.png"), false);
    assert.equal(isRenderableFavicon(null), false);
    assert.equal(isRenderableFavicon(undefined), false);
  });
  it("faviconInitial is the host's letter, or a dot", () => {
    assert.equal(faviconInitial("https://www.github.com/x"), "G");
    assert.equal(faviconInitial("https://127.0.0.1:3000/"), "1");
    assert.equal(faviconInitial("chrome://newtab"), "N");
    assert.equal(faviconInitial(""), "•");
  });
  it("openableUrl admits only plain http(s) links", () => {
    assert.equal(openableUrl("https://a.com/x"), "https://a.com/x");
    assert.equal(openableUrl("http://a.com"), "http://a.com");
    assert.equal(openableUrl("chrome://settings"), null);
    assert.equal(openableUrl("javascript:alert(1)"), null);
  });
});
