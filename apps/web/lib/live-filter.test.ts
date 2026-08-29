import { describe, expect, it } from "vitest";
import type { LiveDevice, LiveTab, LiveWindow } from "@bookmark-ai/types";
import {
  deviceMatchCount,
  filterLiveDevices,
  liveFilterTerms,
  matchingTabs,
  tabMatchesTerms,
  totalMatchCount,
} from "./live-filter";

/**
 * These pin the semantics the mobile copy (`apps/mobile/src/lib/live-filter.ts`)
 * has to match, since only web has a test runner: lowercase, whitespace-split,
 * every term a substring of `title + " " + url`, empty query = no filtering.
 */

function tab(title: string, url: string, extra: Partial<LiveTab> = {}): LiveTab {
  return { title, url, ...extra };
}

function win(windowId: number, tabs: LiveTab[]): LiveWindow {
  return { windowId, tabs };
}

function device(deviceId: string, windows: LiveWindow[]): LiveDevice {
  return {
    deviceId,
    label: deviceId,
    browser: "chrome",
    device: "laptop",
    os: "macOS",
    windows,
    tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
    hiddenTabCount: 0,
    lastSeenAt: "2026-08-27T00:00:00.000Z",
    lastSeenAgeSeconds: 5,
  };
}

describe("liveFilterTerms", () => {
  it("lowercases and splits on whitespace", () => {
    expect(liveFilterTerms("Rust Async")).toEqual(["rust", "async"]);
  });

  it("collapses runs of whitespace and trims", () => {
    expect(liveFilterTerms("  rust \t\n async  ")).toEqual(["rust", "async"]);
  });

  it("yields no terms for an empty or whitespace-only query", () => {
    expect(liveFilterTerms("")).toEqual([]);
    expect(liveFilterTerms("   ")).toEqual([]);
  });
});

describe("tabMatchesTerms", () => {
  const t = tab("The Rust Book", "https://doc.rust-lang.org/book/ch01.html");

  it("matches on the title", () => {
    expect(tabMatchesTerms(t, ["rust"])).toBe(true);
  });

  it("is case-insensitive end to end", () => {
    // Only the HAYSTACK is lowercased here — terms arrive already lowercased
    // from `liveFilterTerms`, which is the pairing every caller uses.
    expect(tabMatchesTerms(t, liveFilterTerms("BOOK"))).toBe(true);
    expect(tabMatchesTerms(t, liveFilterTerms("RuSt BoOk"))).toBe(true);
  });

  it("matches on the URL, including the path", () => {
    expect(tabMatchesTerms(t, ["rust-lang.org"])).toBe(true);
    expect(tabMatchesTerms(t, ["ch01"])).toBe(true);
  });

  it("requires EVERY term (AND, not OR)", () => {
    expect(tabMatchesTerms(t, ["rust", "ch01"])).toBe(true);
    expect(tabMatchesTerms(t, ["rust", "python"])).toBe(false);
  });

  it("lets a term span the title/URL boundary via the joining space", () => {
    // `title + " " + url` — "book https" only exists across the join.
    expect(tabMatchesTerms(t, ["book https"])).toBe(true);
  });

  it("matches every tab when there are no terms", () => {
    expect(tabMatchesTerms(t, [])).toBe(true);
    expect(tabMatchesTerms(tab("", "chrome://newtab"), [])).toBe(true);
  });

  it("still matches a titleless tab on its URL", () => {
    expect(tabMatchesTerms(tab("", "https://example.com/rust"), ["rust"])).toBe(true);
  });
});

describe("matchingTabs", () => {
  const window1 = win(1, [
    tab("The Rust Book", "https://doc.rust-lang.org/book/"),
    tab("Hacker News", "https://news.ycombinator.com/"),
    tab("rust — crates.io", "https://crates.io/search?q=rust"),
  ]);

  it("narrows to the matching tabs, in order", () => {
    expect(matchingTabs(window1, ["rust"]).map((t) => t.url)).toEqual([
      "https://doc.rust-lang.org/book/",
      "https://crates.io/search?q=rust",
    ]);
  });

  it("returns the window's own array untouched with no terms", () => {
    // Identity, not a copy: the unfiltered path must not churn references.
    expect(matchingTabs(window1, [])).toBe(window1.tabs);
  });

  it("returns nothing when no tab matches", () => {
    expect(matchingTabs(window1, ["kotlin"])).toEqual([]);
  });
});

describe("filterLiveDevices / deviceMatchCount / totalMatchCount", () => {
  const laptop = device("laptop", [
    win(1, [tab("The Rust Book", "https://doc.rust-lang.org/book/")]),
    win(2, [tab("Hacker News", "https://news.ycombinator.com/")]),
  ]);
  const phone = device("phone", [win(9, [tab("Weather", "https://weather.example.com/")])]);
  const devices = [laptop, phone];

  it("keeps only devices with at least one matching tab", () => {
    expect(filterLiveDevices(devices, ["rust"]).map((d) => d.deviceId)).toEqual(["laptop"]);
  });

  it("keeps every window on a surviving device, so positional labels don't shift", () => {
    // "Window 2" must stay Window 2 even when only Window 1 has matches — the
    // view hides the non-matching cards, it does not renumber them.
    const [kept] = filterLiveDevices(devices, ["rust"]);
    expect(kept.windows.map((w) => w.windowId)).toEqual([1, 2]);
  });

  it("returns the same array with no terms", () => {
    expect(filterLiveDevices(devices, [])).toBe(devices);
  });

  it("drops everything when nothing matches", () => {
    expect(filterLiveDevices(devices, ["kotlin"])).toEqual([]);
  });

  it("counts matches per device and across devices", () => {
    expect(deviceMatchCount(laptop, ["rust"])).toBe(1);
    expect(deviceMatchCount(phone, ["rust"])).toBe(0);
    expect(totalMatchCount(devices, ["https"])).toBe(3);
    // No terms: every tab "matches", which is what the unfiltered count means.
    expect(totalMatchCount(devices, [])).toBe(3);
  });
});
