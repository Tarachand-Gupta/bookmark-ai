import { describe, expect, it } from "vitest";
import {
  isCapturableTab,
  isCapturableWindow,
  isPrivateWindow,
  isRestorableUrl,
  sessionTabsFromWindow,
  sessionTabsFromWindows,
  type FilterableTab,
  type FilterableWindow,
} from "./session-filter";

/**
 * The incognito filter is a privacy guarantee, so it gets regression tests: a
 * private tab must never reach a session payload. Fixtures mirror the shapes
 * Chrome actually returns — in particular a private window is `type: "normal"`,
 * which is exactly why the pre-existing `win.type` check never caught it.
 */

/** The url a leak would expose. Asserted absent from whole serialized payloads. */
const PRIVATE_URL = "https://secret-bank.example/account/statements";

function tab(url: string, overrides: Partial<FilterableTab> = {}): FilterableTab {
  return {
    url,
    title: `Page at ${url}`,
    favIconUrl: "https://example.com/favicon.ico",
    incognito: false,
    ...overrides,
  };
}

function win(
  id: number,
  tabs: FilterableTab[],
  overrides: Partial<FilterableWindow> = {},
): FilterableWindow {
  return { id, type: "normal", incognito: false, tabs, ...overrides };
}

/** A private window as Chrome reports it: normal type, incognito true, and its
 * tabs each carry incognito: true as well. */
function privateWin(id: number, urls: string[]): FilterableWindow {
  return win(
    id,
    urls.map((u) => tab(u, { incognito: true })),
    { incognito: true },
  );
}

describe("isRestorableUrl", () => {
  it("accepts http and https", () => {
    expect(isRestorableUrl("http://example.com")).toBe(true);
    expect(isRestorableUrl("https://example.com/path?q=1")).toBe(true);
    expect(isRestorableUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects browser-internal and unrestorable schemes", () => {
    for (const url of [
      "chrome://extensions",
      "about:blank",
      "moz-extension://abc/page.html",
      "file:///Users/tara/notes.txt",
      "data:text/html,hi",
      "",
      undefined,
    ]) {
      expect(isRestorableUrl(url)).toBe(false);
    }
  });
});

describe("isCapturableTab", () => {
  it("captures a normal restorable tab", () => {
    expect(isCapturableTab(tab("https://example.com"))).toBe(true);
  });

  it("captures a tab with no incognito field (surfaces that omit it)", () => {
    expect(isCapturableTab({ url: "https://example.com" })).toBe(true);
  });

  it("REFUSES an incognito tab even though its url is restorable", () => {
    expect(isCapturableTab(tab(PRIVATE_URL, { incognito: true }))).toBe(false);
  });

  it("refuses an unrestorable tab and a tab with no url", () => {
    expect(isCapturableTab(tab("chrome://settings"))).toBe(false);
    expect(isCapturableTab({ title: "no url here" })).toBe(false);
  });
});

describe("isCapturableWindow", () => {
  it("accepts a normal window, and one whose type is absent", () => {
    expect(isCapturableWindow(win(1, []))).toBe(true);
    expect(isCapturableWindow({ id: 1, tabs: [] })).toBe(true);
  });

  it("skips devtools and popup windows", () => {
    expect(isCapturableWindow(win(1, [], { type: "devtools" }))).toBe(false);
    expect(isCapturableWindow(win(1, [], { type: "popup" }))).toBe(false);
  });

  it("REFUSES an incognito window despite type 'normal' — the shape that leaked", () => {
    expect(isCapturableWindow({ id: 1, type: "normal", incognito: true, tabs: [] })).toBe(false);
  });
});

describe("isPrivateWindow", () => {
  it("is true only for incognito windows", () => {
    expect(isPrivateWindow(privateWin(1, [PRIVATE_URL]))).toBe(true);
    expect(isPrivateWindow(win(1, []))).toBe(false);
    expect(isPrivateWindow({ id: 1, type: "normal" })).toBe(false);
  });
});

describe("sessionTabsFromWindows — the all-windows walk", () => {
  it("never lets a private window's tabs reach the payload", () => {
    const tabs = sessionTabsFromWindows([
      win(1, [tab("https://example.com/docs")]),
      privateWin(2, [PRIVATE_URL, "https://other-private.example/inbox"]),
    ]);

    expect(tabs).toEqual([
      {
        url: "https://example.com/docs",
        title: "Page at https://example.com/docs",
        favIconUrl: "https://example.com/favicon.ico",
        windowId: 1,
      },
    ]);
    // Strongest form of the guarantee: the private url appears in NO field.
    expect(JSON.stringify(tabs)).not.toContain("secret-bank.example");
    expect(JSON.stringify(tabs)).not.toContain("other-private.example");
  });

  it("drops a private tab inside an otherwise-regular window (spanning mode)", () => {
    // Belt-and-braces: if a window ever reports incognito: false while carrying
    // a private tab, the per-tab check still has to hold.
    const tabs = sessionTabsFromWindows([
      win(1, [tab("https://example.com"), tab(PRIVATE_URL, { incognito: true })]),
    ]);

    expect(tabs.map((t) => t.url)).toEqual(["https://example.com"]);
  });

  it("returns nothing when every window is private", () => {
    expect(sessionTabsFromWindows([privateWin(1, [PRIVATE_URL]), privateWin(2, [PRIVATE_URL])])).toEqual([]);
  });

  it("skips devtools windows and unrestorable tabs, keeping window grouping", () => {
    const tabs = sessionTabsFromWindows([
      win(1, [tab("https://a.example"), tab("chrome://extensions")]),
      win(2, [tab("https://b.example")], { type: "devtools" }),
      win(3, [tab("https://c.example")]),
    ]);

    expect(tabs.map((t) => [t.url, t.windowId])).toEqual([
      ["https://a.example", 1],
      ["https://c.example", 3],
    ]);
  });

  it("defaults a missing title to an empty string", () => {
    const tabs = sessionTabsFromWindows([win(1, [{ url: "https://example.com" }])]);
    expect(tabs[0]?.title).toBe("");
  });
});

describe("sessionTabsFromWindow — the single-window (tabs.query) branch", () => {
  it("drops incognito tabs, which is the only guard on this path", () => {
    // tabs.query({windowId}) never returns a Window object, so if the popup's
    // window is private, per-tab incognito is all that stands in the way.
    const tabs = sessionTabsFromWindow(
      [tab(PRIVATE_URL, { incognito: true }), tab("https://other-private.example", { incognito: true })],
      7,
    );

    expect(tabs).toEqual([]);
    expect(JSON.stringify(tabs)).not.toContain("secret-bank.example");
  });

  it("keeps regular tabs and stamps the requested windowId", () => {
    const tabs = sessionTabsFromWindow(
      [tab("https://example.com"), tab("about:blank"), tab(PRIVATE_URL, { incognito: true })],
      7,
    );

    expect(tabs).toEqual([
      {
        url: "https://example.com",
        title: "Page at https://example.com",
        favIconUrl: "https://example.com/favicon.ico",
        windowId: 7,
      },
    ]);
  });
});
