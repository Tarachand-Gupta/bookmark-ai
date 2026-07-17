import type { Bookmark, Browser, DeviceType, LiveWindow } from "@bookmark-ai/types";
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
 * A `live_devices` row as stored (§4.2). `pushDay`/`pushCount` back the in-row
 * daily quota (§4.6) and `capturedAt` is display metadata only — none of these
 * reach the API `LiveDevice`, which the engine derives (adding the server-computed
 * `lastSeenAgeSeconds`). Kept separate from `LiveDevice` for exactly that reason.
 */
export interface LiveDeviceRow {
  deviceId: string;
  label: string;
  browser: Browser;
  device: DeviceType;
  os: string | null;
  windows: LiveWindow[];
  tabCount: number;
  hiddenTabCount: number;
  capturedAt: string;
  lastSeenAt: string;
  pushDay: string;
  pushCount: number;
  createdAt: string;
}

/** Columns to select whenever a full live device is materialized. */
export const LIVE_DEVICE_COLUMNS = `
  device_id, label, browser, device, os, windows_json,
  tab_count, hidden_tab_count, captured_at, last_seen_at,
  push_day, push_count, created_at
`;

/** Map a `live_devices` row to {@link LiveDeviceRow}. */
export function rowToLiveDevice(row: Row): LiveDeviceRow {
  const windows = safeJson(row.windows_json as string | null);
  return {
    deviceId: String(row.device_id),
    label: String(row.label ?? ""),
    browser: (row.browser as Browser) ?? "other",
    device: (row.device as DeviceType) ?? "other",
    os: (row.os as string | null) ?? null,
    windows: Array.isArray(windows) ? (windows as LiveWindow[]) : [],
    tabCount: Number(row.tab_count ?? 0),
    hiddenTabCount: Number(row.hidden_tab_count ?? 0),
    capturedAt: String(row.captured_at),
    lastSeenAt: String(row.last_seen_at),
    pushDay: String(row.push_day ?? ""),
    pushCount: Number(row.push_count ?? 0),
    createdAt: String(row.created_at),
  };
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
