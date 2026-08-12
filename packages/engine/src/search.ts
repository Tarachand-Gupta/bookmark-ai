import { MAX_SEARCH_DEPTH, type SearchMode, type SearchResponse } from "@bookmark-ai/types";
import {
  mergeHybrid,
  searchFullText,
  searchSessions,
  searchSessionsVector,
  searchVector,
  type Db,
  type Scored,
  type ScoredSession,
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

/** How many saved sessions ride alongside the bookmark results, in every mode. */
export const SESSION_RESULT_LIMIT = 5;

/**
 * Combine the two ways a saved session can match: literal text (name/summary/tab
 * text) and meaning (its embedding). Deduped by session id.
 *
 * Text hits come FIRST, in the order the db query ranked them (self tier before
 * tabs tier), because a session the user's own words appear in is never worse
 * than one merely close in embedding space; the vector-only remainder follows,
 * best similarity first. A session found by BOTH keeps its text score — the
 * scales are incomparable (tier 2/1 vs cosine), so mixing them into one number
 * would be meaningless, exactly as with bookmark results.
 *
 * Pure and exported so the ordering is unit-testable without a DB.
 */
export function mergeSessionResults(
  textResults: ScoredSession[],
  vectorResults: ScoredSession[],
  limit: number,
): ScoredSession[] {
  const seen = new Set(textResults.map((r) => r.session.id));
  const semanticOnly = vectorResults
    .filter((r) => !seen.has(r.session.id))
    .sort((a, b) => b.score - a.score);
  return [...textResults, ...semanticOnly].slice(0, limit);
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

  // Sessions match by plain text in EVERY mode; results ride alongside so
  // clients can present the two kinds distinctly. They are NOT paged — the same
  // handful accompanies every page.
  const textSessionsPromise = searchSessions(db, q, SESSION_RESULT_LIMIT).catch((err: Error) => {
    console.warn(`[search] session search failed: ${err.message}`);
    return [] as ScoredSession[];
  });

  /**
   * The `sessionResults` for this response. When a query embedding was computed
   * for the bookmark search, it is REUSED here to also match sessions by meaning
   * (no second embed call) and merged with the text hits; without one (text mode,
   * or an embed failure) this is the text hits alone, exactly as before.
   */
  const sessionResultsFor = async (vector: number[] | null): Promise<ScoredSession[]> => {
    const text = await textSessionsPromise;
    if (!vector) return text;
    const semantic = await searchSessionsVector(db, vector, SESSION_RESULT_LIMIT).catch(
      (err: Error) => {
        console.warn(`[search] session vector search failed: ${err.message}`);
        return [] as ScoredSession[];
      },
    );
    return mergeSessionResults(text, semantic, SESSION_RESULT_LIMIT);
  };

  if (mode === "hybrid") {
    const textPromise = searchFullText(db, q, candidates);
    let vectorResults: Scored[] = [];
    let queryVector: number[] | null = null;
    let degraded = true;
    if (gemini) {
      try {
        queryVector = await embedQuery(gemini, q);
        vectorResults = await searchVector(db, queryVector, candidates);
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
      sessionResults: await sessionResultsFor(queryVector),
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
        sessionResults: await sessionResultsFor(vector),
      };
    } catch (err) {
      console.warn(`[search] AI search failed, falling back: ${(err as Error).message}`);
    }
  }

  const ranked = await searchFullText(db, q, candidates);
  return {
    mode: "text",
    ...pageOf(ranked, from, limit, paging),
    sessionResults: await sessionResultsFor(null),
    ...(mode === "ai" ? { fallback: true } : {}),
  };
}
