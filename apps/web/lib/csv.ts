import type { Bookmark, Session } from "@bookmark-ai/types";

/**
 * CSV export for the library's bulk-selection bar. Entirely client-side: the
 * rows are already in memory (they're what's on screen), so there is no endpoint
 * and nothing leaves the browser except the download.
 *
 * RFC 4180 to the letter, because the target is Excel and Numbers rather than a
 * lenient parser:
 *  - fields containing `"`, `,`, CR or LF are quoted; inner quotes are doubled;
 *  - records end with CRLF, including the last one;
 *  - the file is prefixed with a UTF-8 BOM, without which Excel on Windows reads
 *    the bytes as its local codepage and mangles every non-ASCII title.
 * A leading BOM is invisible to spreadsheet apps but IS data, so any test or
 * consumer comparing bytes has to expect it (see `CSV_BOM`).
 */

/** Byte-order mark Excel needs to recognise the file as UTF-8. Written as an
 * escape on purpose — as a literal it is an invisible character in the source. */
export const CSV_BOM = "\uFEFF";

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One field, quoted only when it has to be. `null`/`undefined` become empty —
 * never the strings "null"/"undefined", which would then round-trip as data.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (!NEEDS_QUOTING.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Rows (the first being the header) → a CRLF-terminated CSV body, no BOM. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

/** A downloadable Blob: BOM + body, typed so browsers offer "save" not "open". */
export function csvBlob(rows: (string | number | null | undefined)[][]): Blob {
  return new Blob([CSV_BOM, toCsv(rows)], { type: "text/csv;charset=utf-8" });
}

export const BOOKMARK_CSV_HEADER = [
  "url",
  "title",
  "description",
  "category",
  "tags",
  "browser",
  "device",
  "savedAt",
] as const;

/** One row per bookmark; tags collapse to a single pipe-joined field so the
 * column count stays fixed however many tags a bookmark has. */
export function bookmarksToCsvRows(bookmarks: Bookmark[]): (string | null | undefined)[][] {
  return [
    [...BOOKMARK_CSV_HEADER],
    ...bookmarks.map((b) => [
      b.url,
      b.title,
      b.description ?? "",
      b.category,
      b.tags.join("|"),
      b.source.browser,
      b.source.device,
      b.source.savedAt,
    ]),
  ];
}

export const SESSION_CSV_HEADER = [
  "session_name",
  "tab_title",
  "tab_url",
  "browser",
  "device",
  "savedAt",
] as const;

/** One row per TAB (the session's own fields repeat down its block), which is
 * what makes the file useful in a spreadsheet — a nested shape wouldn't be.
 * A session with no tabs still gets a row, so it can't vanish from the export. */
export function sessionsToCsvRows(sessions: Session[]): (string | null | undefined)[][] {
  const rows: (string | null | undefined)[][] = [[...SESSION_CSV_HEADER]];
  for (const s of sessions) {
    if (s.tabs.length === 0) {
      rows.push([s.name, "", "", s.browser, s.device, s.savedAt]);
      continue;
    }
    for (const tab of s.tabs) {
      rows.push([s.name, tab.title ?? "", tab.url, s.browser, s.device, s.savedAt]);
    }
  }
  return rows;
}

/** `bookmark-ai-<kind>-YYYYMMDD.csv`, dated in the user's own timezone. */
export function csvFilename(kind: "bookmarks" | "sessions", now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `bookmark-ai-${kind}-${y}${m}${d}.csv`;
}

/**
 * Hand the blob to the browser as a download. Object URLs leak the whole blob
 * for the document's lifetime, so it's revoked on the next tick — immediately
 * after `click()` cancels the download in some browsers.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function downloadBookmarksCsv(bookmarks: Bookmark[]): void {
  downloadBlob(csvBlob(bookmarksToCsvRows(bookmarks)), csvFilename("bookmarks"));
}

export function downloadSessionsCsv(sessions: Session[]): void {
  downloadBlob(csvBlob(sessionsToCsvRows(sessions)), csvFilename("sessions"));
}
