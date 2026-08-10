/**
 * Sample prompts for the Ask AI empty state, plus the pure rotation math behind
 * the cards (kept out of the component so it's unit-testable — see
 * chat-prompts.test.ts).
 *
 * EVERY prompt here must be answerable by a tool the agent actually has (see the
 * `tools` map in app/api/chat/route.ts):
 *   searchBookmarks · hybrid/full-text/semantic search over saved bookmarks
 *   queryDatabase   · read-only SQL over bookmarks(category, tags_json, saved_day,
 *                     browser, device, domain, …) and sessions(tabs_json, tab_count, …)
 *   listSessions    · saved tab snapshots
 *   listLiveTabs    · tabs open RIGHT NOW on the user's devices (opt-in sharing)
 *   webSearch       · the public web, with links
 *   fetchUrl        · read one page's live text
 *
 * A prompt the agent can't answer is worse than no prompt at all: it's a demo of
 * the product failing. That's why there's no "under 10 minutes to read" prompt —
 * nothing in the schema stores reading time. The reading-list prompt works
 * because a reading list IS a tag here (`reading`/`article`, see
 * packages/engine/src/dashboard.ts READING_TAGS).
 */

/** Which tool the prompt is really exercising — drives the card's icon only. */
export type SamplePromptKind = "search" | "sql" | "sessions" | "live" | "web" | "read";

export interface SamplePrompt {
  /** Stable key; also the crossfade's React key. */
  id: string;
  /** Sent verbatim as the user's message. */
  text: string;
  kind: SamplePromptKind;
}

/**
 * The pool. 16 prompts = four clean pages of four, so the rotation never shows a
 * window that repeats a card it's already showing.
 */
export const CHAT_SAMPLE_PROMPTS: SamplePrompt[] = [
  { id: "categories-grew", text: "Which categories grew the most this month?", kind: "sql" },
  { id: "react-perf", text: "Find that article about React performance I saved", kind: "search" },
  { id: "last-week", text: "What was I researching last week?", kind: "sql" },
  { id: "per-category", text: "How many bookmarks do I have in each category?", kind: "sql" },
  { id: "from-phone", text: "Show me everything I saved from my phone", kind: "sql" },
  { id: "top-domains", text: "What are my top 10 domains?", kind: "sql" },
  { id: "session-summary", text: "Summarize what each of my saved sessions was about", kind: "sessions" },
  { id: "biggest-session", text: "Which saved session has the most tabs?", kind: "sessions" },
  { id: "live-now", text: "What's open on my other devices right now?", kind: "live" },
  { id: "db-reading", text: "Anything saved about Postgres or SQLite?", kind: "search" },
  { id: "top-tags", text: "Which tags do I use most?", kind: "sql" },
  { id: "transformers", text: "Find the paper everyone cites about transformers", kind: "search" },
  { id: "web-news", text: "What's new on the web about the topics I save most?", kind: "web" },
  { id: "summarize-newest", text: "Re-read my newest bookmark and summarize it", kind: "read" },
  { id: "reading-list", text: "Show me everything tagged #reading", kind: "sql" },
  { id: "per-day", text: "How many bookmarks did I save each day this week?", kind: "sql" },
];

/** Cards on screen at once. Exactly four — a 2×2 wide, a stack of four narrow. */
export const SAMPLE_PROMPT_VISIBLE = 4;

/** How long each set of four holds before sliding to the next set. 4s, not 3:
 * the slide itself takes half a second, and owner feedback called the faster
 * cadence "blinking" — the rotation should read as an ambient drift. */
export const SAMPLE_PROMPT_ROTATION_MS = 4_000;

/** Slide duration (outgoing set exits left, incoming enters from the right,
 * ease-in-out). Kept here so the component and the tests agree. */
export const SAMPLE_PROMPT_SLIDE_MS = 500;

/**
 * The `count` prompts starting at `offset`, wrapping around the end of the pool.
 * Never returns the same prompt twice in one window (a pool shorter than `count`
 * simply returns the whole pool), so a window is always a set of distinct cards.
 */
export function promptWindow<T>(
  pool: T[],
  offset: number,
  count: number = SAMPLE_PROMPT_VISIBLE,
): T[] {
  const n = pool.length;
  if (n === 0 || count <= 0) return [];
  if (n <= count) return [...pool];
  const start = ((offset % n) + n) % n;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % n]);
}

/**
 * Advance to the next PAGE of prompts (offset + count), wrapped. Paging by the
 * window size rather than by one means every rotation swaps all four cards, which
 * is what makes the crossfade read as "here are four more ideas" instead of a
 * shuffling carousel.
 */
export function nextPromptOffset(
  offset: number,
  poolLength: number,
  count: number = SAMPLE_PROMPT_VISIBLE,
): number {
  if (poolLength <= 0) return 0;
  return (offset + count) % poolLength;
}

/**
 * Fisher–Yates copy, `random` injectable for tests. Used once per mount so two
 * people (or two visits) don't always meet the same first four — and it's the
 * ONLY variation a reduced-motion visitor gets, since rotation is off for them.
 */
export function shufflePrompts<T>(pool: T[], random: () => number = Math.random): T[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
