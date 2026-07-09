import type { Bookmark } from "@bookmark-ai/types";
import type { Row } from "@libsql/client";

/** Map a `bookmarks` row to the shared Bookmark shape. */
export function rowToBookmark(row: Row): Bookmark {
  const og = safeJson(row.og_json as string | null) ?? {};
  const tags = safeJson(row.tags_json as string | null) ?? [];
  return {
    id: String(row.id),
    url: String(row.url),
    domain: String(row.domain),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    og,
    source: {
      browser: (row.browser as Bookmark["source"]["browser"]) ?? "other",
      device: (row.device as Bookmark["source"]["device"]) ?? "other",
      deviceName: (row.device_name as string | null) ?? null,
      os: (row.os as string | null) ?? null,
      savedAt: String(row.saved_at),
    },
    category: String(row.category),
    tags: Array.isArray(tags) ? tags.map(String) : [],
    createdAt: String(row.created_at),
    // Selected as `(embedding IS NOT NULL) AS embedding` — an integer 0/1.
    embedded: Boolean(Number(row.embedding)),
  };
}

function safeJson(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Columns to select whenever a full Bookmark is materialized (never the raw
 * blob). Qualified with the table name so joins (e.g. against the FTS index)
 * stay unambiguous.
 */
export const BOOKMARK_COLUMNS = `
  bookmarks.id, bookmarks.url, bookmarks.domain, bookmarks.title,
  bookmarks.description, bookmarks.og_json,
  bookmarks.browser, bookmarks.device, bookmarks.device_name, bookmarks.os,
  bookmarks.saved_at, bookmarks.saved_day,
  bookmarks.category, bookmarks.tags_json, bookmarks.created_at,
  (bookmarks.embedding IS NOT NULL) AS embedding
`;
