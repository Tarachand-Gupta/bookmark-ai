import { pageOf, type ToolPageMeta } from "./chat-tools";

/**
 * The CHAT CARD half of the tool paging contract: the output shapes the four
 * list tools emit (`searchBookmarks`, `queryDatabase`, `listSessions`,
 * `listLiveTabs` — see docs/features/chat-tool-paging.md) and the pure logic
 * every client's cards share — folding long groups, the substring filter,
 * flatten/regroup for live tabs, and the client-side "next page" for the
 * sources that hand back a whole snapshot (sessions, live tabs).
 *
 * Framework-free on purpose: the web (React DOM), mobile (React Native) and
 * the Swift port (a hand port with its own tests) all render THESE decisions,
 * so a fold threshold or a grouping rule changes in one place.
 */

// ── Tool output shapes ───────────────────────────────────────────────────────

export interface BookmarkHit {
  id: string;
  title: string;
  url: string;
  category: string;
  tags: string[];
  day: string;
  score: number;
}

export interface SearchToolOutput {
  /** Echoed so the card's "Load more" can re-run the same search. */
  query?: string;
  mode: string;
  fallback: boolean;
  results: BookmarkHit[];
  page?: ToolPageMeta;
}

export interface SqlToolOutput {
  /** Echoed so the card's "Load more" can re-run the same SELECT. */
  sql?: string;
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  page?: ToolPageMeta;
}

export interface WebSearchOutput {
  results: { title: string; url: string; snippet: string }[];
}

export interface FetchUrlOutput {
  url?: string;
  title?: string | null;
  text?: string;
  truncated?: boolean;
  error?: string;
}

export interface SessionHit {
  id: string;
  name: string;
  description?: string | null;
  tabCount: number;
  browser: string;
  savedAt: string;
  tabs: { title: string; url: string }[];
}

export interface SessionsToolOutput {
  query?: string | null;
  sessions: SessionHit[];
  page?: ToolPageMeta;
  /** Legacy field from turns stored before paging shipped. */
  total?: number;
}

/** One live tab as the chat tool compacts it (favicon kept for the CARD only —
 * the model gets a text digest). */
export interface LiveTabHit {
  title: string;
  url: string;
  favIconUrl?: string | null;
}

/** One open window on a device. `index` is the 1-based display order; `windowId`
 * is the browser's own id (display grouping only, never a key). */
export interface LiveWindowHit {
  windowId?: number;
  name?: string | null;
  index?: number;
  /** Tabs this window has in total — a paged group still says "12 of 34". */
  windowTabCount?: number;
  tabs: LiveTabHit[];
}

export interface LiveDeviceHit {
  label: string;
  browser: string;
  lastSeenAgeSeconds: number;
  /** Tabs open on this device in total (ignores the filter and the page). */
  tabCount: number;
  /** Tabs on this device matching the tool's `query` (ignores the page). */
  matchingTabCount?: number;
  /** Tabs this device is NOT sharing, per its live-sharing rules. */
  hiddenTabCount: number;
  windows: LiveWindowHit[];
}

/** listLiveTabs output: `{enabled:false}` = sharing off, `{error}` = unavailable,
 * else the compacted live devices. Discriminated by which field is present. */
export interface LiveTabsToolOutput {
  enabled?: boolean;
  error?: string;
  query?: string | null;
  devices?: LiveDeviceHit[];
  page?: ToolPageMeta;
}

/** `createSkill` / `installSkill` → `{ skill: { id, name, description, enabled? } }`. */
export interface SkillToolOutput {
  skill?: { id?: string; name?: string; description?: string; enabled?: boolean };
}

// ── Folding ──────────────────────────────────────────────────────────────────

/** Rows shown per group before the rest folds behind "show N more". */
export const CARD_COLLAPSED_ROWS = 10;
/** How many more rows one "show more" click reveals — a 92-tab window opens in
 * readable chunks instead of dumping everything into the thread at once. */
export const CARD_EXPAND_CHUNK = 25;

export interface FoldState {
  /** Rows to render right now. */
  visibleCount: number;
  /** Rows still folded away. */
  hidden: number;
  /** The group has been opened past its collapsed size. */
  expanded: boolean;
  /** How many the next click reveals — the button says so. */
  nextChunk: number;
}

/**
 * What a group of `total` rows shows when `shown` rows have been requested
 * (`shown` starts at `limit` and grows by `chunk` per click).
 */
export function foldState(
  total: number,
  shown: number,
  limit = CARD_COLLAPSED_ROWS,
  chunk = CARD_EXPAND_CHUNK,
): FoldState {
  const visibleCount = Math.max(0, Math.min(total, shown));
  const hidden = Math.max(0, total - visibleCount);
  return {
    visibleCount,
    hidden,
    expanded: visibleCount > limit,
    nextChunk: Math.min(chunk, hidden),
  };
}

/** The next `shown` after a click: reveal one more chunk, or — when everything
 * is already showing — snap back to the collapsed size. */
export function nextFoldShown(
  total: number,
  shown: number,
  limit = CARD_COLLAPSED_ROWS,
  chunk = CARD_EXPAND_CHUNK,
): number {
  return shown >= total ? limit : Math.min(total, shown + chunk);
}

/** "Show 25 more (44 left)" / "Show 3 more tabs" / "Show less". */
export function showMoreLabel(hidden: number, nextChunk: number | undefined, noun: string): string {
  if (hidden <= 0) return "Show less";
  const step = Math.min(nextChunk ?? hidden, hidden);
  if (step < hidden) return `Show ${step} more (${hidden} left)`;
  return `Show ${hidden} more ${hidden === 1 ? noun : `${noun}s`}`;
}

// ── Filtering ────────────────────────────────────────────────────────────────

/** Case-insensitive substring filter; an empty/blank query keeps everything. */
export function filterByText<T>(
  items: readonly T[],
  haystack: (item: T) => string,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => haystack(item).toLowerCase().includes(q));
}

/** True when `query` (trimmed, case-insensitive) appears in any field. */
export function matchesText(query: string | null | undefined, ...fields: (string | null | undefined)[]): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}

// ── Small formatters ─────────────────────────────────────────────────────────

// No `URL` here: this package compiles without a DOM lib (it is shared with
// React Native and read by the Swift port), so the two URL helpers are
// regex-based and behave the same on every runtime.
const AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i;

/** `https://www.example.com/a` → `example.com`; unparsable input comes back as-is. */
export function hostOf(url: string): string {
  const match = AUTHORITY.exec(url);
  if (!match) return url;
  const authority = match[1] ?? "";
  const afterUserinfo = authority.slice(authority.lastIndexOf("@") + 1);
  // Strip a port, but not the colons of a bracketed IPv6 literal.
  const host = afterUserinfo.startsWith("[")
    ? afterUserinfo.slice(0, afterUserinfo.indexOf("]") + 1)
    : (afterUserinfo.split(":")[0] ?? "");
  return host.replace(/^www\./i, "").toLowerCase() || url;
}

/** The URL if it is a plain http(s) link, else undefined — the only kind a card
 * may open (javascript:, chrome://, data: render as text). */
export function safeHttpUrl(url: string): string | undefined {
  return /^https?:\/\/[^/?#\s]+/i.test(url) ? url : undefined;
}

/** A SQL cell as text: null/undefined → "", objects → JSON, else String(). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** "1 tab" / "12 tabs". */
export function pluralize(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? noun : plural}`;
}

/** Whether the page footer has anything to say: a next page, a non-first
 * offset, or an error — a card holding the whole first, complete result stays
 * footer-less. */
export function pageFooterVisible(
  page: ToolPageMeta | undefined,
  firstOffset: number,
  error: string | null,
): boolean {
  if (!page) return false;
  return page.hasMore || firstOffset !== 0 || error !== null;
}

// ── Live tabs: flatten ↔ regroup ─────────────────────────────────────────────

/**
 * One tab plus the device/window it belongs to. Paging happens over this FLAT
 * order (matching the server's), and the sections are rebuilt from whatever is
 * loaded — so "load more" appends into the right groups instead of restarting.
 */
export interface FlatLiveTab {
  device: LiveDeviceHit;
  windowId?: number;
  windowName: string | null;
  windowIndex: number;
  windowTabCount: number;
  tab: LiveTabHit;
}

export function flattenLiveDevices(devices: readonly LiveDeviceHit[]): FlatLiveTab[] {
  const out: FlatLiveTab[] = [];
  for (const d of devices) {
    for (const w of d.windows ?? []) {
      for (const t of w.tabs ?? []) {
        out.push({
          device: d,
          windowId: w.windowId,
          windowName: w.name ?? null,
          windowIndex: w.index ?? 1,
          windowTabCount: w.windowTabCount ?? (w.tabs ?? []).length,
          tab: t,
        });
      }
    }
  }
  return out;
}

export type RegroupedLiveDevice = LiveDeviceHit & {
  /** Tabs of this device currently loaded in the card (page + filter). */
  loadedTabCount: number;
};

/** Flat tabs → device sections → window groups, preserving first-seen order.
 * Devices are keyed by label, windows by `windowId` (else display index). */
export function regroupLiveTabs(flat: readonly FlatLiveTab[]): RegroupedLiveDevice[] {
  const byDevice = new Map<string, RegroupedLiveDevice>();
  const windows = new Map<string, Map<string, LiveWindowHit>>();
  for (const f of flat) {
    const dKey = f.device.label;
    let device = byDevice.get(dKey);
    if (!device) {
      device = { ...f.device, windows: [], loadedTabCount: 0 };
      byDevice.set(dKey, device);
      windows.set(dKey, new Map());
    }
    device.loadedTabCount++;
    const wKey = String(f.windowId ?? f.windowIndex);
    const wins = windows.get(dKey)!;
    let win = wins.get(wKey);
    if (!win) {
      win = {
        windowId: f.windowId,
        name: f.windowName,
        index: f.windowIndex,
        windowTabCount: f.windowTabCount,
        tabs: [],
      };
      wins.set(wKey, win);
      device.windows.push(win);
    }
    win.tabs.push(f.tab);
  }
  return [...byDevice.values()];
}

/** The subset of a `GET /live` snapshot the client-side pager reads — every
 * client's `ListLiveResponse` type satisfies it structurally. */
export interface LiveSnapshotLike {
  devices: readonly {
    label: string;
    browser: string;
    lastSeenAgeSeconds: number;
    tabCount: number;
    hiddenTabCount: number;
    windows: readonly {
      windowId?: number;
      name?: string | null;
      tabs: readonly { title?: string | null; url: string; favIconUrl?: string | null }[];
    }[];
  }[];
}

/**
 * The card's "Load next 50" for live tabs: the live server hands back the
 * whole current snapshot in one call, so a later page is the same
 * flatten → filter → slice the tool did, done here.
 */
export function pageLiveSnapshot(
  live: LiveSnapshotLike,
  toolQuery: string | null | undefined,
  offset: number,
  limit: number,
): { rows: FlatLiveTab[]; page: ToolPageMeta } {
  const flat: FlatLiveTab[] = [];
  for (const d of live.devices) {
    d.windows.forEach((w, wi) => {
      for (const t of w.tabs) {
        const title = t.title ?? "";
        if (!matchesText(toolQuery, title, t.url)) continue;
        flat.push({
          device: {
            label: d.label,
            browser: d.browser,
            lastSeenAgeSeconds: d.lastSeenAgeSeconds,
            tabCount: d.tabCount,
            hiddenTabCount: d.hiddenTabCount,
            windows: [],
          },
          windowId: w.windowId,
          windowName: w.name ?? null,
          windowIndex: wi + 1,
          windowTabCount: w.tabs.length,
          tab: { title, url: t.url, favIconUrl: t.favIconUrl ?? null },
        });
      }
    });
  }
  const { items, page } = pageOf(flat, offset, limit);
  return { rows: items, page };
}

// ── Sessions: client-side page over the whole list ───────────────────────────

/** The subset of a `GET /api/sessions` row the client-side pager reads. */
export interface SessionLike {
  id: string;
  name: string;
  description?: string | null;
  tabCount: number;
  browser: string;
  savedAt: string;
  tabs: readonly { title?: string | null; url: string }[];
}

/** The tool ships at most this many tabs per session. */
export const SESSION_CARD_TAB_LIMIT = 15;

/** The same filter the `listSessions` tool applies: name, description, tab titles/URLs. */
export function filterSessions<T extends SessionLike>(all: readonly T[], toolQuery: string | null | undefined): T[] {
  const q = toolQuery?.trim().toLowerCase();
  if (!q) return [...all];
  return all.filter((sn) =>
    [sn.name, sn.description ?? "", ...sn.tabs.flatMap((t) => [t.title ?? "", t.url])].some((f) =>
      f.toLowerCase().includes(q),
    ),
  );
}

/** `/api/sessions` returns the whole (small) list in one call, so a later page
 * is sliced from it: the tool's filter, then the tool's offset. */
export function pageSessionsSnapshot(
  all: readonly SessionLike[],
  toolQuery: string | null | undefined,
  offset: number,
  limit: number,
): { rows: SessionHit[]; page: ToolPageMeta } {
  const { items, page } = pageOf(filterSessions(all, toolQuery), offset, limit);
  return {
    rows: items.map((sn) => ({
      id: sn.id,
      name: sn.name,
      description: sn.description ?? null,
      tabCount: sn.tabCount,
      browser: sn.browser,
      savedAt: sn.savedAt,
      tabs: sn.tabs.slice(0, SESSION_CARD_TAB_LIMIT).map((t) => ({ title: t.title ?? "", url: t.url })),
    })),
    page,
  };
}

// ── Bookmarks: a search page → hits ──────────────────────────────────────────

/** The subset of a `/api/search` result the card maps onto a `BookmarkHit`. */
export interface SearchResultLike {
  score: number;
  bookmark: {
    id: string;
    title: string;
    url: string;
    category: string;
    tags: readonly string[];
    source: { savedAt: string };
  };
}

/** `GET /api/search?offset=` → the card's next page of hits. Ranked retrieval
 * never knows a total, so `total` is null and `hasMore` drives the button. */
export function pageSearchResponse(
  results: readonly SearchResultLike[],
  hasMore: boolean | undefined,
  offset: number,
  limit: number,
): { rows: BookmarkHit[]; page: ToolPageMeta } {
  const more = hasMore === true;
  return {
    rows: results.map(({ score, bookmark: b }) => ({
      id: b.id,
      title: b.title,
      url: b.url,
      category: b.category,
      tags: [...b.tags],
      day: b.source.savedAt.slice(0, 10),
      score,
    })),
    page: { total: null, offset, limit, hasMore: more, nextOffset: more ? offset + limit : null },
  };
}
