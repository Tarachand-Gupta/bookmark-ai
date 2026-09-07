import { z } from "zod";

/**
 * PAGING CONTRACT for the Ask AI agent's list-shaped tools.
 *
 * Every tool that can return many rows (`searchBookmarks`, `queryDatabase`,
 * `listSessions`, `listLiveTabs`) takes `limit` + `offset` and returns ONE PAGE
 * plus this metadata. The model reads the page verbatim — nothing is summarized
 * away from it — and pages further when the question needs it; the chat UI
 * renders the same page as an interactive card and lets the USER page on
 * without spending a model turn.
 *
 * Shared here because the mobile and macOS chat clients render the same shapes.
 * See docs/features/chat-tool-paging.md for the per-tool schemas.
 */

/** Rows per page. Also the MAXIMUM a tool call may ask for. */
export const TOOL_PAGE_LIMIT = 50;

/** Where a page sits in the whole result — the tail of every list tool output. */
export interface ToolPageMeta {
  /**
   * Total rows the query matches, or `null` when the source can't cheaply know
   * (ranked search, which only retrieves to a bounded depth).
   */
  total: number | null;
  /** Rows skipped before this page. */
  offset: number;
  /** Page size that produced it. */
  limit: number;
  /** True when more rows follow. */
  hasMore: boolean;
  /** The `offset` that fetches the next page, or null at the end. */
  nextOffset: number | null;
}

/** Clamp a model-supplied page size into `1..TOOL_PAGE_LIMIT`. */
export function clampPageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) return TOOL_PAGE_LIMIT;
  return Math.min(TOOL_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Clamp a model-supplied offset to a non-negative integer. */
export function clampPageOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset) || offset === undefined) return 0;
  return Math.max(0, Math.floor(offset));
}

/** Slice `items` into a page and describe it. For in-memory sources (sessions,
 * live tabs) where the total IS known. */
export function pageOf<T>(
  items: readonly T[],
  offset: number,
  limit: number,
): { items: T[]; page: ToolPageMeta } {
  const from = clampPageOffset(offset);
  const size = clampPageLimit(limit);
  const slice = items.slice(from, from + size);
  const hasMore = items.length > from + size;
  return {
    items: slice,
    page: {
      total: items.length,
      offset: from,
      limit: size,
      hasMore,
      nextOffset: hasMore ? from + size : null,
    },
  };
}

/** "rows 51–100 of 312" / "rows 1–8 of 8" — the label every card shows. */
export function describePageRange(page: ToolPageMeta, shown: number): string {
  if (shown === 0) return "no rows";
  const first = page.offset + 1;
  const last = page.offset + shown;
  const of = page.total === null ? "" : ` of ${page.total.toLocaleString("en-US")}`;
  return `${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")}${of}`;
}

/**
 * POST /api/query body — the chat SQL card's "Load more". Mirrors the
 * `queryDatabase` tool's paging arguments; the SQL itself is validated by the
 * engine's read-only guards, not here.
 */
export const chatQueryPageSchema = z.object({
  sql: z.string().min(1).max(20_000),
  limit: z.number().int().min(1).max(TOOL_PAGE_LIMIT).default(TOOL_PAGE_LIMIT),
  offset: z.number().int().min(0).default(0),
});
export type ChatQueryPageInput = z.infer<typeof chatQueryPageSchema>;
