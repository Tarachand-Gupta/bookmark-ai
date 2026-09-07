import { describe, expect, it } from "vitest";
import { isJunkTitle, pickBookmarkTitle } from "@bookmark-ai/engine";

const yt = { domain: "youtube.com", siteName: "YouTube" };

describe("isJunkTitle", () => {
  it("flags empty titles and separator-only leftovers", () => {
    expect(isJunkTitle(null, yt)).toBe(true);
    expect(isJunkTitle("", yt)).toBe(true);
    expect(isJunkTitle(" - ", yt)).toBe(true);
  });

  it("flags the bare site name, also behind a template separator", () => {
    expect(isJunkTitle("YouTube", yt)).toBe(true);
    expect(isJunkTitle("- YouTube", yt)).toBe(true);
    expect(isJunkTitle("| youtube.com", yt)).toBe(true);
    expect(isJunkTitle("Medium", { domain: "medium.com" })).toBe(true);
    expect(isJunkTitle("news.ycombinator.com", { domain: "news.ycombinator.com" })).toBe(true);
  });

  it("flags consent walls, bot checks, login gates and error pages", () => {
    for (const t of [
      "Just a moment...",
      "Attention Required! | Cloudflare",
      "Access Denied",
      "Are you a robot?",
      "Before you continue to YouTube",
      "Sign in - Google Accounts",
      "Log in | Instagram",
      "403 Forbidden",
      "404 Not Found",
      "Page not found",
      "Untitled",
    ]) {
      expect(isJunkTitle(t, { domain: "example.com" }), t).toBe(true);
    }
  });

  it("keeps real titles, including ones that merely mention the site", () => {
    expect(isJunkTitle("What the heck is the event loop anyway? - YouTube", yt)).toBe(false);
    expect(isJunkTitle("Hacker News", { domain: "news.ycombinator.com" })).toBe(false);
    expect(isJunkTitle("Obsidian - Sharpen your thinking", { domain: "obsidian.md" })).toBe(false);
    expect(isJunkTitle("Signing in to the API with OAuth", { domain: "docs.example.com" })).toBe(false);
    expect(isJunkTitle("404: the story of a lost page", { domain: "blog.example.com" })).toBe(false);
  });
});

describe("pickBookmarkTitle", () => {
  it("prefers an informative scraped title over the client title", () => {
    expect(pickBookmarkTitle("React v19 – React", "react.dev/blog", { domain: "react.dev" })).toBe("React v19 – React");
  });

  it("keeps the client title when the scrape hit a consent wall", () => {
    expect(pickBookmarkTitle("- YouTube", "What the heck is the event loop anyway? | JSConf EU", yt)).toBe(
      "What the heck is the event loop anyway? | JSConf EU",
    );
    expect(pickBookmarkTitle("Just a moment...", "Kyoto Travel Guide", { domain: "japan-guide.com" })).toBe(
      "Kyoto Travel Guide",
    );
  });

  it("degrades gracefully when both candidates are junk or missing", () => {
    expect(pickBookmarkTitle("- YouTube", null, yt)).toBe("YouTube");
    expect(pickBookmarkTitle(null, "  ", yt)).toBe("youtube.com");
    expect(pickBookmarkTitle(null, "YouTube", yt)).toBe("YouTube");
    expect(pickBookmarkTitle("Access Denied", "Access Denied", { domain: "example.com" })).toBe("Access Denied");
  });

  it("trims the winning title", () => {
    expect(pickBookmarkTitle("  The Illustrated Transformer \n", null, { domain: "jalammar.github.io" })).toBe(
      "The Illustrated Transformer",
    );
  });
});
