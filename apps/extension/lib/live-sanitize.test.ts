import { describe, expect, it } from "vitest";
import {
  buildLiveWindows,
  sanitizeFavicon,
  sanitizeLiveUrl,
  type LiveInputTab,
  type LiveInputWindow,
} from "./live-sanitize";

/**
 * Capture-time sanitization is a security boundary (§5.4): a live checkpoint copies
 * urls into a cloud DB, so a bearer token that slips through is a real credential
 * leak. These regression-test the denylist, the auth-path redaction, and — as the
 * strongest form — that a secret never appears anywhere in the serialized payload.
 */

/** The credential a leak would expose. Asserted absent from whole payloads. */
const SECRET = "aB3ZzTopSecretToken";

describe("sanitizeLiveUrl", () => {
  it("passes a plain url through untouched", () => {
    expect(sanitizeLiveUrl("https://example.com/docs/page")).toEqual({
      url: "https://example.com/docs/page",
      redacted: false,
    });
  });

  it("returns null for non-http(s) schemes (they are never sent)", () => {
    for (const url of [
      "chrome://extensions",
      "about:blank",
      "file:///Users/tara/notes.txt",
      "moz-extension://abc/page.html",
      "view-source:https://example.com",
    ]) {
      expect(sanitizeLiveUrl(url)).toBeNull();
    }
  });

  it("strips credential-bearing query params but keeps benign ones", () => {
    const out = sanitizeLiveUrl(`https://app.example/x?token=${SECRET}&page=2&q=zig`);
    expect(out?.redacted).toBe(false);
    expect(out?.url).not.toContain(SECRET);
    expect(out?.url).not.toContain("token");
    expect(out?.url).toContain("page=2");
    expect(out?.url).toContain("q=zig");
  });

  it("matches the denylist as a case-insensitive substring", () => {
    // access_token, sessionId, apiKey all contain a denylisted substring.
    const out = sanitizeLiveUrl(
      `https://app.example/x?Access_Token=${SECRET}&sessionId=${SECRET}&apiKey=${SECRET}&keep=1`,
    );
    expect(out?.url).not.toContain(SECRET);
    expect(out?.url).toContain("keep=1");
  });

  it("strips utm_* tracking params", () => {
    const out = sanitizeLiveUrl("https://example.com/a?utm_source=news&utm_medium=x&id=5");
    expect(out?.url).not.toContain("utm_");
    expect(out?.url).toContain("id=5");
  });

  it("keeps a short #anchor but drops a token-bearing or long fragment", () => {
    expect(sanitizeLiveUrl("https://example.com/a#install")?.url).toBe(
      "https://example.com/a#install",
    );
    expect(sanitizeLiveUrl(`https://example.com/a#access_token=${SECRET}`)?.url).toBe(
      "https://example.com/a",
    );
    expect(sanitizeLiveUrl(`https://example.com/a#${"x".repeat(40)}`)?.url).toBe(
      "https://example.com/a",
    );
  });

  it("reduces an auth-flow path to the origin and flags it redacted", () => {
    for (const url of [
      `https://acme.example/login/${SECRET}`,
      `https://acme.example/reset?token=${SECRET}`,
      `https://acme.example/oauth/callback?code=${SECRET}`,
      `https://acme.example/verify/${SECRET}`,
    ]) {
      const out = sanitizeLiveUrl(url);
      expect(out).toEqual({ url: "https://acme.example", redacted: true });
      expect(JSON.stringify(out)).not.toContain(SECRET);
    }
  });

  it("does not redact an ordinary path", () => {
    const out = sanitizeLiveUrl("https://example.com/dashboard/reports?range=30d");
    expect(out?.redacted).toBe(false);
    expect(out?.url).toContain("range=30d");
  });
});

describe("sanitizeFavicon", () => {
  it("keeps http(s) favicons and drops everything else", () => {
    expect(sanitizeFavicon("https://cdn.example/f.ico")).toBe("https://cdn.example/f.ico");
    expect(sanitizeFavicon("data:image/png;base64,AAAA")).toBeUndefined();
    expect(sanitizeFavicon("chrome://favicon/https://x")).toBeUndefined();
    expect(sanitizeFavicon(undefined)).toBeUndefined();
    expect(sanitizeFavicon(null)).toBeUndefined();
  });
});

function tab(url: string, overrides: Partial<LiveInputTab> = {}): LiveInputTab {
  return {
    url,
    title: `Page ${url}`,
    favIconUrl: "https://cdn.example/f.ico",
    incognito: false,
    active: false,
    ...overrides,
  };
}

function win(
  id: number,
  tabs: LiveInputTab[],
  overrides: Partial<LiveInputWindow> = {},
): LiveInputWindow {
  return { id, type: "normal", incognito: false, focused: false, tabs, ...overrides };
}

describe("buildLiveWindows", () => {
  it("captures http tabs and counts non-http ones as hidden", () => {
    const { windows, hiddenTabCount } = buildLiveWindows([
      win(1, [tab("https://a.example"), tab("chrome://extensions"), tab("https://b.example")]),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.tabs.map((t) => t.url)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(hiddenTabCount).toBe(1);
  });

  it("excludes an incognito window entirely and never counts it (no private-count leak)", () => {
    const { windows, hiddenTabCount } = buildLiveWindows([
      win(1, [tab("https://a.example")]),
      win(2, [tab(`https://secret.example/${SECRET}`, { incognito: true })], { incognito: true }),
    ]);
    expect(windows.map((w) => w.windowId)).toEqual([1]);
    expect(hiddenTabCount).toBe(0); // the incognito window contributes nothing, not even a count
    expect(JSON.stringify(windows)).not.toContain(SECRET);
  });

  it("drops an incognito tab inside a normal window (spanning mode), uncounted", () => {
    const { windows, hiddenTabCount } = buildLiveWindows([
      win(1, [tab("https://a.example"), tab(`https://secret.example/${SECRET}`, { incognito: true })]),
    ]);
    expect(windows[0]?.tabs.map((t) => t.url)).toEqual(["https://a.example/"]);
    expect(hiddenTabCount).toBe(0);
    expect(JSON.stringify(windows)).not.toContain(SECRET);
  });

  it("drops a window that has no capturable tabs, but still counts its hidden tabs", () => {
    const { windows, hiddenTabCount } = buildLiveWindows([
      win(1, [tab("chrome://settings"), tab("about:blank")]),
      win(2, [tab("https://keep.example")]),
    ]);
    expect(windows.map((w) => w.windowId)).toEqual([2]);
    expect(hiddenTabCount).toBe(2);
  });

  it("sanitizes each tab url and preserves the redacted flag", () => {
    // Benign titles here: titles are deliberately NOT sanitized (§5.4), so this
    // asserts the url path specifically — the only place the token could survive.
    const { windows } = buildLiveWindows([
      win(1, [
        tab(`https://app.example/reset?token=${SECRET}`, { title: "Reset password" }),
        tab(`https://app.example/search?q=zig&token=${SECRET}`, { title: "Search results" }),
      ]),
    ]);
    expect(windows[0]?.tabs[0]).toMatchObject({ url: "https://app.example", redacted: true });
    expect(windows[0]?.tabs[1]?.url).toContain("q=zig");
    expect(JSON.stringify(windows)).not.toContain(SECRET);
  });

  it("drops data: favicons and preserves active/focused flags", () => {
    const { windows } = buildLiveWindows([
      win(
        1,
        [tab("https://a.example", { active: true, favIconUrl: "data:image/png;base64,AAAA" })],
        { focused: true },
      ),
    ]);
    expect(windows[0]?.focused).toBe(true);
    expect(windows[0]?.tabs[0]?.active).toBe(true);
    expect(windows[0]?.tabs[0]?.favIconUrl).toBeUndefined();
  });

  it("caps at 12 windows and 100 tabs per window (schema limits)", () => {
    const manyWindows = Array.from({ length: 15 }, (_, i) => win(i + 1, [tab(`https://w${i}.example`)]));
    expect(buildLiveWindows(manyWindows).windows).toHaveLength(12);

    const manyTabs = Array.from({ length: 130 }, (_, i) => tab(`https://t.example/${i}`));
    expect(buildLiveWindows([win(1, manyTabs)]).windows[0]?.tabs).toHaveLength(100);
  });

  it("truncates an over-long title to 300 chars", () => {
    const { windows } = buildLiveWindows([
      win(1, [tab("https://a.example", { title: "x".repeat(500) })]),
    ]);
    expect(windows[0]?.tabs[0]?.title).toHaveLength(300);
  });
});
