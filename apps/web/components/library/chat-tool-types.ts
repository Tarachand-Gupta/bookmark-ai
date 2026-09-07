import type { ToolPageMeta } from "@bookmark-ai/types";

/**
 * The tool output shapes the chat cards render, exactly as app/api/chat/route.ts
 * emits them. The shapes themselves live in `@bookmark-ai/types`
 * (packages/types/src/chat-tool-cards.ts) because the mobile app renders the
 * same cards from the same contract; this module keeps the web's import path.
 *
 * Every list tool returns ONE PAGE plus a `page` object (see
 * packages/types/src/chat-tools.ts and docs/features/chat-tool-paging.md): the
 * model reads the page verbatim, and the card lets the user fetch the next one
 * without a model turn.
 */

export type { ToolPageMeta };
export type {
  BookmarkHit,
  FetchUrlOutput,
  LiveDeviceHit,
  LiveTabHit,
  LiveTabsToolOutput,
  LiveWindowHit,
  SearchToolOutput,
  SessionHit,
  SessionsToolOutput,
  SkillToolOutput,
  SqlToolOutput,
  WebSearchOutput,
} from "@bookmark-ai/types";
