/**
 * The tool output shapes the chat cards render, exactly as app/api/chat/route.ts
 * emits them. Kept in one React-free module so the card components, the tool row
 * and any test can share them without importing each other's JSX.
 */

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
  mode: string;
  fallback: boolean;
  results: BookmarkHit[];
}

export interface SqlToolOutput {
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
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
  total: number;
  sessions: SessionHit[];
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
  tabs: LiveTabHit[];
}

export interface LiveDeviceHit {
  label: string;
  browser: string;
  lastSeenAgeSeconds: number;
  tabCount: number;
  hiddenTabCount: number;
  windows: LiveWindowHit[];
}

/** listLiveTabs output: `{enabled:false}` = sharing off, `{error}` = unavailable,
 * else the compacted live devices. Discriminated by which field is present. */
export interface LiveTabsToolOutput {
  enabled?: boolean;
  error?: string;
  devices?: LiveDeviceHit[];
}

/** `createSkill` / `installSkill` → `{ skill: { id, name, description, enabled? } }`. */
export interface SkillToolOutput {
  skill?: { id?: string; name?: string; description?: string; enabled?: boolean };
}
