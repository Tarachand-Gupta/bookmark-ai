import { describe, expect, it } from "vitest";
import type { ListLiveResponse } from "@bookmark-ai/types";
import { paginateLiveTabs } from "./live-tabs-page";

const tab = (i: number, host = "example.com") => ({
  url: `https://${host}/${i}`,
  title: `Tab ${i}`,
  favIconUrl: `https://${host}/favicon.ico`,
});

/** Two devices: 60 tabs in two windows, then 32 in one. */
const live = (): ListLiveResponse =>
  ({
    enabled: true,
    ttlHours: 168,
    devices: [
      {
        deviceId: "d1",
        label: "MacBook",
        browser: "chrome",
        device: "laptop",
        os: "macOS",
        tabCount: 60,
        hiddenTabCount: 3,
        lastSeenAt: "2026-09-07T00:00:00.000Z",
        lastSeenAgeSeconds: 12,
        windows: [
          { windowId: 1, tabs: Array.from({ length: 40 }, (_, i) => tab(i)) },
          { windowId: 2, name: "Reading", tabs: Array.from({ length: 20 }, (_, i) => tab(100 + i, "rust-lang.org")) },
        ],
      },
      {
        deviceId: "d2",
        label: "iPhone",
        browser: "safari",
        device: "mobile",
        os: "iOS",
        tabCount: 32,
        hiddenTabCount: 0,
        lastSeenAt: "2026-09-07T00:00:00.000Z",
        lastSeenAgeSeconds: 300,
        windows: [{ windowId: 1, tabs: Array.from({ length: 32 }, (_, i) => tab(200 + i, "digitalocean.com")) }],
      },
    ],
  }) as unknown as ListLiveResponse;

type Device = {
  label: string;
  tabCount: number;
  matchingTabCount: number;
  hiddenTabCount: number;
  windows: { windowId?: number; index: number; windowTabCount: number; tabs: { title: string; url: string }[] }[];
};

describe("paginateLiveTabs", () => {
  it("returns the first 50 of 92 tabs, re-nested into device and window groups", () => {
    const out = paginateLiveTabs(live(), undefined, 50, 0);
    expect(out.page).toEqual({ total: 92, offset: 0, limit: 50, hasMore: true, nextOffset: 50 });
    const devices = out.devices as Device[];
    // Page one stops inside the MacBook's second window — the iPhone isn't on it.
    expect(devices.map((d) => d.label)).toEqual(["MacBook"]);
    expect(devices[0].windows.map((w) => w.tabs.length)).toEqual([40, 10]);
    // Each window still reports its FULL size, so a partial group says "10 of 20".
    expect(devices[0].windows.map((w) => w.windowTabCount)).toEqual([40, 20]);
    expect(devices[0].tabCount).toBe(60);
  });

  it("continues from nextOffset without repeating or skipping a tab", () => {
    const first = paginateLiveTabs(live(), undefined, 50, 0);
    const second = paginateLiveTabs(live(), undefined, 50, first.page.nextOffset!);
    expect(second.page).toEqual({ total: 92, offset: 50, limit: 50, hasMore: false, nextOffset: null });
    const urls = (d: { devices: unknown }) =>
      (d.devices as Device[]).flatMap((x) => x.windows.flatMap((w) => w.tabs.map((t) => t.url)));
    const all = [...urls(first), ...urls(second)];
    expect(all).toHaveLength(92);
    expect(new Set(all).size).toBe(92);
  });

  it("filters server-side so one narrow call replaces paging", () => {
    const out = paginateLiveTabs(live(), "digitalocean", 50, 0);
    const devices = out.devices as Device[];
    expect(out.page.total).toBe(32);
    expect(devices.map((d) => d.label)).toEqual(["iPhone"]);
    // The device keeps its true totals while reporting what matched.
    expect(devices[0].tabCount).toBe(32);
    expect(devices[0].matchingTabCount).toBe(32);
  });

  it("matches titles as well as URLs, case-insensitively", () => {
    const out = paginateLiveTabs(live(), "TAB 205", 50, 0);
    expect(out.page.total).toBe(1);
    expect((out.devices as Device[])[0].windows[0].tabs[0].title).toBe("Tab 205");
  });

  it("is an empty page when nothing matches", () => {
    const out = paginateLiveTabs(live(), "nothing-here", 50, 0);
    expect(out.devices).toEqual([]);
    expect(out.page).toEqual({ total: 0, offset: 0, limit: 50, hasMore: false, nextOffset: null });
  });

  it("clamps a hostile limit to the page cap and keeps favicons http-only", () => {
    const out = paginateLiveTabs(live(), undefined, 5_000, -3);
    expect(out.page.limit).toBe(50);
    expect(out.page.offset).toBe(0);
    const tabs = (out.devices as Device[])[0].windows[0].tabs as { favIconUrl?: string | null }[];
    expect(tabs[0].favIconUrl).toBe("https://example.com/favicon.ico");
  });
});
