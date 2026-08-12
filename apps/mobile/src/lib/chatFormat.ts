import type { SymbolViewProps } from "expo-symbols";
import { ageLabel } from "./live";

/**
 * Presentation helpers for the Ask AI surfaces: how a conversation's age reads in
 * the history list, and how one agent tool call reads as a status chip. Pure
 * functions, no React — the components stay about layout.
 */

/** A week, in seconds: the point where "N days ago" stops being useful. */
const WEEK_SECONDS = 7 * 86400;

/**
 * Relative age for a conversation's `updatedAt` (an ISO timestamp). Delegates to
 * the live tab's `ageLabel` for anything inside a week so both lists speak the
 * same phrases ("just now", "12 min ago", "3 days ago"), then falls back to a
 * short date. Unlike the live server's ages, this one HAS to read the local
 * clock: /api/chat/conversations returns timestamps, not deltas.
 */
export function conversationTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const seconds = (Date.now() - t) / 1000;
  if (seconds < 0) return "just now"; // clock skew — never render "in -3 min"
  if (seconds < WEEK_SECONDS) return ageLabel(seconds);
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface ToolChipCopy {
  /** While the call is in flight. */
  running: string;
  /** Once its output landed. */
  done: string;
  symbol: SymbolViewProps["name"];
  fallback: string;
}

/**
 * One entry per tool in the agent's `tools` map (apps/web/app/api/chat/route.ts).
 * A UIMessage tool part's type is `tool-${toolName}`, so the key here is the raw
 * tool name. Icons mirror the web's tool cards, so a chip and its web
 * counterpart read as the same step.
 */
const TOOL_COPY: Record<string, ToolChipCopy> = {
  searchBookmarks: {
    running: "Searching bookmarks…",
    done: "Searched bookmarks",
    symbol: "magnifyingglass",
    fallback: "⌕",
  },
  queryDatabase: {
    running: "Querying your library…",
    done: "Queried your library",
    symbol: "tablecells",
    fallback: "▦",
  },
  listSessions: {
    running: "Checking saved sessions…",
    done: "Checked saved sessions",
    symbol: "square.stack",
    fallback: "▤",
  },
  listLiveTabs: {
    running: "Checking live tabs…",
    done: "Checked live tabs",
    symbol: "dot.radiowaves.left.and.right",
    fallback: "◉",
  },
  webSearch: {
    running: "Searching the web…",
    done: "Searched the web",
    symbol: "globe",
    fallback: "◍",
  },
  fetchUrl: {
    running: "Reading page…",
    done: "Read page",
    symbol: "doc.text",
    fallback: "▥",
  },
};

/** Copy for a `tool-*` part type, or a generic chip for a tool we don't know
 * (a server-side addition must never render a blank row on an older build). */
export function toolChipCopy(partType: string): ToolChipCopy {
  const name = partType.startsWith("tool-") ? partType.slice(5) : partType;
  return (
    TOOL_COPY[name] ?? {
      running: "Working…",
      done: "Done",
      symbol: "sparkles",
      fallback: "✦",
    }
  );
}
