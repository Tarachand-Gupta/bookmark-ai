import { describe, expect, it } from "vitest";
import {
  flattenBrowserBookmarks,
  parseBookmarkImportText,
  BOOKMARK_IMPORT_MAX_BYTES,
} from "@bookmark-ai/types";

describe("bookmark import source extraction", () => {
  it("preserves Netscape folders, entities and original timestamps without executing markup", () => {
    const preview = parseBookmarkImportText({
      action: "preview",
      source: "html",
      content: `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3>Work &amp; ideas</H3><DL><p><DT><H3>Research</H3><DL>
      <DT><A HREF="https://example.com/?a=1&amp;b=2" ADD_DATE="1700000000">A &quot;useful&quot; page</A>
      </DL><DT><A HREF='https://example.org'>Another</A></DL>
      <DT><A HREF="javascript:alert(1)">Unsafe</A><script><A href="https://fake.test">Not a bookmark</A></script></DL>`,
    });
    expect(preview.items).toHaveLength(2);
    expect(preview.items[0]).toMatchObject({
      url: "https://example.com/?a=1&b=2",
      title: 'A "useful" page',
      folderPath: ["Work & ideas", "Research"],
      savedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(preview.items[1].folderPath).toEqual(["Work & ideas"]);
    expect(preview.invalidCount).toBe(1);
  });
  it("extracts notes links only and dedupes exact URL identity", () => {
    const preview = parseBookmarkImportText({
      action: "preview",
      source: "markdown",
      content:
        "Private body. [Docs](https://example.com/docs) and <https://example.org>.\nhttps://example.com/docs",
    });
    expect(preview.items.map((item) => [item.title, item.url])).toEqual([
      ["Docs", "https://example.com/docs"],
      ["https://example.org", "https://example.org"],
    ]);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.warnings[0]).toContain("Only web links");
    expect(JSON.stringify(preview)).not.toContain("Private body");
  });
  it("keeps query and fragment identity, strips prose punctuation", () => {
    const preview = parseBookmarkImportText({
      action: "preview",
      source: "text",
      content:
        "(https://example.com/a_(b)). https://example.com/?q=x#top! https://example.com/?q=x#other",
    });
    expect(preview.items.map((item) => item.url)).toEqual([
      "https://example.com/a_(b)",
      "https://example.com/?q=x#top",
      "https://example.com/?q=x#other",
    ]);
  });
  it("keeps balanced parentheses in Markdown destinations and optional titles", () => {
    const preview = parseBookmarkImportText({
      action: "preview",
      source: "markdown",
      content:
        '[Nested](https://example.com/a_(b)) [Title](https://example.org \"reference\") [Angle](<https://example.net/a_(b)>)',
    });
    expect(preview.items.map((item) => item.url)).toEqual([
      "https://example.com/a_(b)",
      "https://example.org",
      "https://example.net/a_(b)",
    ]);
  });
  it("explains unsupported ZIP and backup sources", () => {
    expect(() =>
      parseBookmarkImportText({ action: "preview", source: "html", content: "PK\u0003\u0004rest" }),
    ).toThrow("Extract the ZIP");
    expect(() =>
      parseBookmarkImportText({
        action: "preview",
        source: "text",
        content: '{"schemaVersion":5}',
      }),
    ).toThrow("Restore backup");
  });
  it("bounds bytes, count and hierarchy rather than truncating", () => {
    expect(() =>
      parseBookmarkImportText({
        action: "preview",
        source: "text",
        content: "é".repeat(BOOKMARK_IMPORT_MAX_BYTES / 2 + 1),
      }),
    ).toThrow("5 MB");
    expect(() =>
      parseBookmarkImportText({
        action: "preview",
        source: "browser",
        items: Array.from({ length: 5001 }, (_, i) => ({ url: `https://example.org/${i}` })),
      }),
    ).toThrow("5,000");
    expect(() =>
      parseBookmarkImportText({
        action: "preview",
        source: "html",
        content: "<H3>A</H3><DL>".repeat(21),
      }),
    ).toThrow("nesting");
  });
  it("flattens browser snapshots with folders and rejects non-web entries at preview", () => {
    const items = flattenBrowserBookmarks([
      {
        children: [
          {
            title: "Toolbar",
            children: [
              { title: "Docs", url: "https://example.org", dateAdded: 1700000000000 },
              { url: "chrome://settings" },
            ],
          },
        ],
      },
    ]);
    const preview = parseBookmarkImportText({ action: "preview", source: "browser", items });
    expect(preview.items[0]).toMatchObject({
      title: "Docs",
      folderPath: ["Toolbar"],
      savedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(preview.invalidCount).toBe(1);
  });
});
