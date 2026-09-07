import {
  cellText,
  hostOf,
  pluralize,
  safeHttpUrl,
  type LiveTabsToolOutput,
  type SqlToolOutput,
  type ToolPageMeta,
} from "@bookmark-ai/types";
import { ageLabel } from "./live";

/**
 * The mobile-only decisions behind the chat's tool cards — copy strings, the
 * SQL total-carry rule, favicon fallbacks. Pure (no React) so they are covered
 * by `tsx --test`; the fold/filter/page mechanics themselves live in
 * `@bookmark-ai/types` (chat-tool-cards.ts) and are only re-exported here so a
 * card reaches everything through one module.
 */
export {
  CARD_COLLAPSED_ROWS,
  CARD_EXPAND_CHUNK,
  cellText,
  describePageRange,
  filterByText,
  flattenLiveDevices,
  foldState,
  hostOf,
  nextFoldShown,
  pageFooterVisible,
  pageLiveSnapshot,
  pageSearchResponse,
  pageSessionsSnapshot,
  pluralize,
  regroupLiveTabs,
  safeHttpUrl,
  showMoreLabel,
} from "@bookmark-ai/types";

/** A card holding more rows than this gets a filter box; sessions are taller
 * per row, so their threshold is lower. */
export const FILTER_MIN_ROWS = 6;
export const SESSIONS_FILTER_MIN_ROWS = 4;

export function showFilter(count: number, min = FILTER_MIN_ROWS): boolean {
  return count > min;
}

// ── Toolbar summaries ────────────────────────────────────────────────────────

/** "3 of 12" while a filter is active, else "12 results" / "31 tabs". */
export function countSummary(active: boolean, filtered: number, loaded: number, noun: string): string {
  return active ? `${filtered} of ${loaded}` : pluralize(loaded, noun);
}

/** The live card's summary: the filter count, or "31 tabs · 2 devices" using
 * the tool's total (the card may hold only the first page of it). */
export function liveTabsSummary(
  active: boolean,
  filtered: number,
  loaded: number,
  total: number | null | undefined,
  deviceCount: number,
): string {
  if (active) return `${filtered} of ${loaded}`;
  return `${pluralize(total ?? loaded, "tab")} · ${pluralize(deviceCount, "device")}`;
}

/** The sessions card's summary: the filter count, or the tool's total. */
export function sessionsSummary(
  active: boolean,
  filtered: number,
  loaded: number,
  total: number | null | undefined,
): string {
  return active ? `${filtered} of ${loaded}` : pluralize(total ?? loaded, "session");
}

// ── Live tabs ────────────────────────────────────────────────────────────────

/** "13 of 31 tabs · as of 2 min ago" for a partially loaded device, else
 * "31 tabs · as of just now". */
export function deviceTabsLabel(loaded: number, total: number, ageSeconds: number): string {
  const count = loaded < total ? `${loaded} of ${total} tabs` : pluralize(total, "tab");
  return `${count} · as of ${ageLabel(ageSeconds)}`;
}

/** "12 of 34 tabs" when a window is only partly loaded, else "34 tabs". */
export function windowTabsLabel(loaded: number, total: number): string {
  return loaded < total ? `${loaded} of ${total} tabs` : pluralize(total, "tab");
}

/** The name a window group shows: its own name, else "Window N". */
export function windowTitle(name: string | null | undefined, index: number): string {
  return name?.trim() || `Window ${index}`;
}

/** The per-device note for tabs held back by the live-sharing rules, or null. */
export function hiddenTabsNote(hidden: number): string | null {
  if (hidden <= 0) return null;
  return `${pluralize(hidden, "tab")} on this device ${hidden === 1 ? "is" : "are"} in windows that aren’t shared to live sessions`;
}

/**
 * The one-line note a live card shows INSTEAD of sections: sharing off, the
 * live server unreachable, or nothing matched — null when there is data.
 */
export function liveTabsNote(
  output: Pick<LiveTabsToolOutput, "enabled" | "error" | "query">,
  loadedRows: number,
): string | null {
  if (output.error) return "Live tabs are unavailable right now.";
  if (!output.enabled) {
    return "Live sharing is off — turn on “Live sessions” sharing in the extension to let the assistant see your current tabs.";
  }
  if (loadedRows === 0) {
    const q = output.query?.trim();
    return q ? `No open tab matches “${q}”.` : "No devices are sharing live tabs right now.";
  }
  return null;
}

// ── Bookmarks ────────────────────────────────────────────────────────────────

/** "example.com · 2026-09-01" (the day is optional on legacy hits). */
export function bookmarkSubtitle(url: string, day: string | null | undefined): string {
  const host = hostOf(url);
  return day ? `${host} · ${day}` : host;
}

/** "87% match" — shown only for semantic ("ai") searches, where the score is a
 * similarity worth reading; hybrid RRF scores are rank fusions, not percents. */
export function scoreLabel(score: number): string {
  return `${Math.round(score * 100)}% match`;
}

export function showScores(mode: string | undefined): boolean {
  return mode === "ai";
}

/** The chips a hit shows: its category, then at most four tags. */
export const BOOKMARK_TAG_CHIPS = 4;

export function visibleTags(tags: readonly string[] | undefined): string[] {
  return (tags ?? []).slice(0, BOOKMARK_TAG_CHIPS);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** "Chrome · 12 tabs" — the session header's trailing meta. Only the browser
 * is capitalized (a CSS-style capitalize would also title-case "Tabs"). */
export function sessionMeta(browser: string, tabCount: number): string {
  const name = browser ? browser.charAt(0).toUpperCase() + browser.slice(1) : "Browser";
  return `${name} · ${pluralize(tabCount, "tab")}`;
}

/** Tabs a session holds beyond what the tool shipped (it caps at 15 per
 * session), or 0 — the card spells the count out rather than promising rows. */
export function beyondPayload(tabCount: number | undefined, shipped: number): number {
  return Math.max(0, (tabCount ?? 0) - shipped);
}

export function beyondPayloadNote(n: number): string | null {
  return n > 0 ? `+${n} more in the session` : null;
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/** What the SQL card can draw right now: the statement (from the input, so it
 * shows while streaming and after a failure) and the settled table, if any. */
export function sqlCardState(
  input: unknown,
  output: SqlToolOutput | undefined,
): { sql: string; table: { columns: string[]; rows: unknown[][] } | null } {
  const raw = input !== null && typeof input === "object" ? (input as { sql?: unknown }).sql : undefined;
  const sql = typeof raw === "string" ? raw.trim() : "";
  const table =
    output && Array.isArray(output.columns) && Array.isArray(output.rows)
      ? { columns: output.columns, rows: output.rows }
      : null;
  return { sql, table };
}

/**
 * The total-carry rule: `/api/query` never recounts, so a later page's meta
 * keeps the total the FIRST page established (null when it had none).
 */
export function carrySqlTotal(next: ToolPageMeta, first: ToolPageMeta | undefined): ToolPageMeta {
  return { ...next, total: first?.total ?? null };
}

export const SQL_CLIPPED_NOTE = "Long cell values were clipped.";

/** Column width bounds (pt) for the SQL table — a cell wider than the max wraps
 * to up to three lines, and the table scrolls sideways past the thread. */
export const SQL_COLUMN_MIN_WIDTH = 72;
export const SQL_COLUMN_MAX_WIDTH = 200;
/** Average glyph advance of the 13pt system font, plus cell padding. */
const SQL_CHAR_WIDTH = 7.4;
const SQL_CELL_PADDING = 20;

/**
 * One fixed width per column so every row lines up — React Native has no
 * table layout, and independent flex rows would jog each column by its own
 * content. Sized from the longest text the column shows (header included),
 * clamped to the bounds above.
 */
export function sqlColumnWidths(columns: readonly string[], rows: readonly unknown[][]): number[] {
  return columns.map((header, ci) => {
    let longest = header.length;
    for (const row of rows) {
      const len = cellText(row[ci]).length;
      if (len > longest) longest = len;
    }
    const width = Math.ceil(longest * SQL_CHAR_WIDTH + SQL_CELL_PADDING);
    return Math.max(SQL_COLUMN_MIN_WIDTH, Math.min(SQL_COLUMN_MAX_WIDTH, width));
  });
}

// ── Favicons ─────────────────────────────────────────────────────────────────

/** Only schemes RN's Image can load. Live tabs come off real browser windows,
 * so a favicon can be `chrome://` or `moz-extension://` — those never reach
 * the image loader. Same rule as FaviconTile in components/BookmarkRow.tsx. */
export function isRenderableFavicon(url: string | null | undefined): boolean {
  return typeof url === "string" && /^(https?:|data:image\/)/i.test(url);
}

/** The letter a favicon-less tab shows: the host's initial, else a dot. */
export function faviconInitial(url: string): string {
  const host = hostOf(url).trim();
  const first = host.charAt(0);
  return /[a-z0-9]/i.test(first) ? first.toUpperCase() : "•";
}

/** The URL a row may open, or null — `chrome://`, `javascript:` and friends
 * render as plain text. */
export function openableUrl(url: string): string | null {
  return safeHttpUrl(url) ?? null;
}
