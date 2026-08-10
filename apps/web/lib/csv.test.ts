import { describe, expect, it } from "vitest";
import type { Bookmark, Session } from "@bookmark-ai/types";
import {
  BOOKMARK_CSV_HEADER,
  CSV_BOM,
  SESSION_CSV_HEADER,
  bookmarksToCsvRows,
  csvBlob,
  csvFilename,
  escapeCsvField,
  sessionsToCsvRows,
  toCsv,
} from "./csv";

describe("escapeCsvField", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("a b - c")).toBe("a b - c");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("empties null and undefined rather than writing their names", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("keeps an empty string empty (no stray quotes)", () => {
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("Hooks, patterns and pitfalls")).toBe(
      '"Hooks, patterns and pitfalls"',
    );
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
    // A field that is nothing but a quote still has to be quoted+doubled.
    expect(escapeCsvField('"')).toBe('""""');
  });

  it("quotes fields containing newlines, LF or CRLF", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvField("line one\r\nline two")).toBe('"line one\r\nline two"');
    expect(escapeCsvField("bare\rcr")).toBe('"bare\rcr"');
  });

  it("does not quote for characters that don't need it", () => {
    expect(escapeCsvField("semi;colon | pipe\ttab")).toBe("semi;colon | pipe\ttab");
  });
});

describe("toCsv", () => {
  it("joins fields with commas and terminates every record with CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d\r\n");
  });

  it("produces nothing for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("escapes per field, so a quoted field can't break the record layout", () => {
    const csv = toCsv([
      ["url", "title"],
      ["https://x.test/", 'Comma, "quote" and\nnewline'],
    ]);
    expect(csv).toBe(
      'url,title\r\nhttps://x.test/,"Comma, ""quote"" and\nnewline"\r\n',
    );
    // Two records → exactly two CRLFs; the newline inside the quoted field is a
    // bare LF and must NOT have become a record separator.
    expect(csv.match(/\r\n/g)).toHaveLength(2);
  });
});

describe("csvBlob", () => {
  it("prefixes the UTF-8 BOM and declares the charset", async () => {
    const blob = csvBlob([["title"], ["Café"]]);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    // Asserted on the BYTES: Blob.text() runs a UTF-8 decode, which strips a
    // leading BOM — so reading it back as a string can't tell whether the BOM
    // Excel needs was actually written.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await blob.text()).toBe("title\r\nCafé\r\n");
    // The BOM is a single U+FEFF code point, not three literal characters.
    expect(CSV_BOM).toHaveLength(1);
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff);
  });
});

describe("csvFilename", () => {
  it("dates the file with a zero-padded local Y-M-D", () => {
    expect(csvFilename("bookmarks", new Date(2026, 7, 9))).toBe(
      "bookmark-ai-bookmarks-20260809.csv",
    );
    expect(csvFilename("sessions", new Date(2026, 11, 31))).toBe(
      "bookmark-ai-sessions-20261231.csv",
    );
  });
});

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm_1",
    url: "https://example.com/a",
    domain: "example.com",
    title: "A title",
    description: "A description",
    og: {},
    source: {
      browser: "chrome",
      device: "laptop",
      savedAt: "2026-08-09T10:00:00.000Z",
    },
    category: "Engineering",
    tags: ["react", "hooks"],
    createdAt: "2026-08-09T10:00:01.000Z",
    embedded: true,
    ...overrides,
  };
}

describe("bookmarksToCsvRows", () => {
  it("emits the documented header and one row per bookmark", () => {
    const rows = bookmarksToCsvRows([bookmark()]);
    expect(rows[0]).toEqual([...BOOKMARK_CSV_HEADER]);
    expect(rows[1]).toEqual([
      "https://example.com/a",
      "A title",
      "A description",
      "Engineering",
      "react|hooks",
      "chrome",
      "laptop",
      "2026-08-09T10:00:00.000Z",
    ]);
  });

  it("pipe-joins tags and empties a missing description", () => {
    const rows = bookmarksToCsvRows([bookmark({ description: null, tags: [] })]);
    expect(rows[1][2]).toBe("");
    expect(rows[1][4]).toBe("");
  });

  it("survives a title with every hostile character", () => {
    const csv = toCsv(
      bookmarksToCsvRows([bookmark({ title: 'Say "no", then\r\nsay yes' })]),
    );
    expect(csv).toContain('"Say ""no"", then\r\nsay yes"');
    // Header + one data record, so the embedded CRLF stayed inside its quotes.
    expect(csv.split('"Say')[0]).toBe(`${BOOKMARK_CSV_HEADER.join(",")}\r\nhttps://example.com/a,`);
  });

  it("emits only the header for an empty selection", () => {
    expect(bookmarksToCsvRows([])).toEqual([[...BOOKMARK_CSV_HEADER]]);
  });
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s_1",
    name: "Morning reading",
    tabs: [
      { url: "https://a.test/", title: "A" },
      { url: "https://b.test/", title: "B, with comma" },
    ],
    tabCount: 2,
    browser: "firefox",
    device: "desktop",
    os: "macOS",
    savedAt: "2026-08-08T07:00:00.000Z",
    createdAt: "2026-08-08T07:00:01.000Z",
    ...overrides,
  };
}

describe("sessionsToCsvRows", () => {
  it("writes one row per tab, repeating the session's own columns", () => {
    const rows = sessionsToCsvRows([session()]);
    expect(rows[0]).toEqual([...SESSION_CSV_HEADER]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      "Morning reading",
      "A",
      "https://a.test/",
      "firefox",
      "desktop",
      "2026-08-08T07:00:00.000Z",
    ]);
    expect(rows[2][1]).toBe("B, with comma");
    // Quoting happens at serialisation, not in the row builder.
    expect(toCsv(rows)).toContain('"B, with comma"');
  });

  it("keeps a tabless session as one row instead of dropping it", () => {
    const rows = sessionsToCsvRows([session({ tabs: [], tabCount: 0 })]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([
      "Morning reading",
      "",
      "",
      "firefox",
      "desktop",
      "2026-08-08T07:00:00.000Z",
    ]);
  });

  it("concatenates multiple sessions in order", () => {
    const rows = sessionsToCsvRows([
      session({ id: "s_1", name: "First" }),
      session({ id: "s_2", name: "Second", tabs: [{ url: "https://c.test/", title: "C" }] }),
    ]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["First", "First", "Second"]);
  });
});
