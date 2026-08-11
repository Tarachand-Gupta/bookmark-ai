import { MAX_SEARCH_DEPTH, type SearchMode, type SearchResponse } from "@bookmark-ai/types";
import {
  mergeHybrid,
  searchFullText,
  searchSessions,
  searchVector,
  type Db,
  type Scored,
} from "@bookmark-ai/db";
import { embedQuery } from "./embeddings";
import type { GeminiClient } from "./gemini";

export interface SearchParams {
  q: string;
  mode: SearchMode;
  limit: number;
  /**
   * Zero-based start of the page to return. OMIT it for the first page — the
   * response is then byte-identical to the pre-paging one. Passing it (even 0)
   * opts into the `offset`/`hasMore` fields, at the cost of retrieving one row
   * deeper than the page to know whether a next page exists.
   *
   * `offset + limit` is clamped to MAX_SEARCH_DEPTH; callers coming through
   * `searchQuerySchema` (REST) or the MCP tool are rejected before that instead.
   */
  offset?: number;
}

/**
 * Cut the requested window out of a full ranking.
 *
 * Slicing happens HERE, after retrieval and (for hybrid) after the fusion, which
 * is the whole subtlety of paging a blended search: an SQL `OFFSET` on either
 * candidate list would drop rows the fusion still needs, so both lists are
 * fetched to the page's full depth and only the fused order is cut.
 */
function pageOf(
  ranked: Scored[],
  offset: number,
  limit: number,
  paging: boolean,
): { results: Scored[]; offset?: number; hasMore?: boolean } {
  if (!paging) return { results: ranked.slice(0, limit) };
  return {
    results: ranked.slice(offset, offset + limit),
    offset,
    // The ranking continued past this page. `ranked` was retrieved one row
    // deeper than the page for exactly this answer, so no count query is needed.
    hasMore: ranked.length > offset + limit,
  };
}

/**
 * The one search implementation every surface shares (Next.js routes, the MCP
 * tools, the chat agent's tools). Hybrid mode runs full-text and vector
 * rankings and fuses them with Reciprocal Rank Fusion; ai/hybrid degrade to
 * full-text with `fallback: true` when embeddings are unavailable.
 *
 * Paging: every page re-runs retrieval from rank 0 to the end of that page
 * (`offset + limit`, the "depth") and slices the tail. Ranked retrieval has no
 * cursor — a page can only be located inside the ranking that produced it — and
 * for hybrid BOTH candidate lists must reach that depth before the merge, or the
 * fused order of the rows on the page would be wrong.
 */
export async function performSearch(
  db: Db,
  gemini: GeminiClient | null,
  { q, mode, limit, offset }: SearchParams,
): Promise<SearchResponse> {
  const paging = offset !== undefined;
  const from = offset ?? 0;
  const depth = Math.min(from + limit, MAX_SEARCH_DEPTH);
  // One row past the page, only when someone is paging: it makes `hasMore`
  // exact and leaves the non-paging queries (and their SQL) untouched.
  const candidates = depth + (paging ? 1 : 0);

  // Sessions match by plain text in every mode (they have no embeddings);
  // results ride alongside so clients can present the two kinds distinctly.
  // They are NOT paged — the same handful accompanies every page.
  const sessionsPromise = searchSessions(db, q, 5).catch((err: Error) => {
    console.warn(`[search] session search failed: ${err.message}`);
    return [];
  });

  if (mode === "hybrid") {
    const textPromise = searchFullText(db, q, candidates);
    let vectorResults: Scored[] = [];
    let degraded = true;
    if (gemini) {
      try {
        const vector = await embedQuery(gemini, q);
        vectorResults = await searchVector(db, vector, candidates);
        degraded = false;
      } catch (err) {
        console.warn(`[search] hybrid embed failed, text only: ${(err as Error).message}`);
      }
    }
    // Merge WITHOUT a limit: the fused union is the ranking to page through.
    const merged = mergeHybrid(await textPromise, vectorResults);
    return {
      mode: "hybrid",
      ...pageOf(merged, from, limit, paging),
      sessionResults: await sessionsPromise,
      ...(degraded ? { fallback: true } : {}),
    };
  }

  if (mode === "ai" && gemini) {
    try {
      const vector = await embedQuery(gemini, q);
      const ranked = await searchVector(db, vector, candidates);
      return {
        mode: "ai",
        ...pageOf(ranked, from, limit, paging),
        sessionResults: await sessionsPromise,
      };
    } catch (err) {
      console.warn(`[search] AI search failed, falling back: ${(err as Error).message}`);
    }
  }

  const ranked = await searchFullText(db, q, candidates);
  return {
    mode: "text",
    ...pageOf(ranked, from, limit, paging),
    sessionResults: await sessionsPromise,
    ...(mode === "ai" ? { fallback: true } : {}),
  };
}
