import type { ToolPageMeta } from "@bookmark-ai/types";

/**
 * The tool output shapes the chat cards render, exactly as app/api/chat/route.ts
 * emits them. Kept in one React-free module so the card components, the tool row
 * and any test can share them without importing each other's JSX.
 *
 * Every list tool returns ONE PAGE plus a `page` object (see
 * packages/types/src/chat-tools.ts and docs/features/chat-tool-paging.md): the
 * model reads the page verbatim, and the card lets the user fetch the next one
 * without a model turn.
 */

export type { ToolPageMeta };

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
 * the model gets a text digest, see lib/server/chat-tool-summary.ts). */
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
