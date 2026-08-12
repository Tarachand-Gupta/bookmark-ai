import type { SymbolViewProps } from "expo-symbols";

/**
 * Sample prompts for an empty thread — the answer to "I opened this, now what?".
 *
 * Sourced from the web app's pool (apps/web/lib/chat-prompts.ts) so both clients
 * demo the same product. Same hard rule as there: EVERY prompt must be
 * answerable by a tool the agent actually has (searchBookmarks, queryDatabase,
 * listSessions, listLiveTabs, webSearch, fetchUrl) — a prompt the agent can't
 * answer is a demo of the product failing.
 *
 * Four, not sixteen: a phone shows one screenful of chips and there is no
 * rotation carousel here (the web's animated 2×2 grid is a pointer-hover
 * affordance; on touch it would slide out from under a thumb).
 */
export interface SamplePrompt {
  id: string;
  text: string;
  symbol: SymbolViewProps["name"];
  fallback: string;
}

export const CHAT_SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    id: "per-category",
    text: "How many bookmarks do I have in each category?",
    symbol: "tablecells",
    fallback: "▦",
  },
  {
    id: "last-week",
    text: "What was I researching last week?",
    symbol: "magnifyingglass",
    fallback: "⌕",
  },
  {
    id: "top-domains",
    text: "What are my top 10 domains?",
    symbol: "tablecells",
    fallback: "▦",
  },
  {
    id: "session-summary",
    text: "Summarize what each of my saved sessions was about",
    symbol: "square.stack",
    fallback: "▤",
  },
];
