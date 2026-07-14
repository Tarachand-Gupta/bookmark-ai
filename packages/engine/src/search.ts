import type { SearchMode, SearchResponse } from "@bookmark-ai/types";
import {
  mergeHybrid,
  searchFullText,
  searchSessions,
  searchVector,
  type Db,
} from "@bookmark-ai/db";
import { embedQuery } from "./embeddings";
import type { GeminiClient } from "./gemini";

export interface SearchParams {
  q: string;
  mode: SearchMode;
  limit: number;
}

/**
 * The one search implementation every surface shares (Express, Next.js
 * routes, the chat agent's tools). Hybrid mode runs full-text and vector
 * rankings and fuses them with Reciprocal Rank Fusion; ai/hybrid degrade to
 * full-text with `fallback: true` when embeddings are unavailable.
 */
export async function performSearch(
  db: Db,
  gemini: GeminiClient | null,
  { q, mode, limit }: SearchParams,
): Promise<SearchResponse> {
  // Sessions match by plain text in every mode (they have no embeddings);
  // results ride alongside so clients can present the two kinds distinctly.
  const sessionsPromise = searchSessions(db, q, 5).catch((err: Error) => {
    console.warn(`[search] session search failed: ${err.message}`);
    return [];
  });

  if (mode === "hybrid") {
    const textPromise = searchFullText(db, q, limit);
    let vectorResults: Awaited<ReturnType<typeof searchVector>> = [];
    let degraded = true;
    if (gemini) {
      try {
        const vector = await embedQuery(gemini, q);
        vectorResults = await searchVector(db, vector, limit);
        degraded = false;
      } catch (err) {
        console.warn(`[search] hybrid embed failed, text only: ${(err as Error).message}`);
      }
    }
    return {
      mode: "hybrid",
      results: mergeHybrid(await textPromise, vectorResults, limit),
      sessionResults: await sessionsPromise,
      ...(degraded ? { fallback: true } : {}),
    };
  }

  if (mode === "ai" && gemini) {
    try {
      const vector = await embedQuery(gemini, q);
      const results = await searchVector(db, vector, limit);
      return { mode: "ai", results, sessionResults: await sessionsPromise };
    } catch (err) {
      console.warn(`[search] AI search failed, falling back: ${(err as Error).message}`);
    }
  }

  const results = await searchFullText(db, q, limit);
  return {
    mode: "text",
    results,
    sessionResults: await sessionsPromise,
    ...(mode === "ai" ? { fallback: true } : {}),
  };
}
