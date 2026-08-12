import type { Bookmark } from "@bookmark-ai/types";
import type { Db } from "../client";
import { BOOKMARK_COLUMNS, rowToBookmark } from "../rows";

export interface Scored {
  bookmark: Bookmark;
  score: number;
  /** Set by mergeHybrid: the keyword (FTS) list found this result. */
  exact?: boolean;
}

/**
 * Full-text search over title/description/url/category/tags via FTS5.
 * bm25() returns lower-is-better, so it is negated into a higher-is-better score.
 */
export async function searchFullText(db: Db, query: string, limit: number): Promise<Scored[]> {
  const match = toFtsQuery(query);
  if (!match) return [];
  const rs = await db.execute({
    sql: `
      SELECT ${BOOKMARK_COLUMNS}, bm25(bookmarks_fts) AS rank
      FROM bookmarks_fts
      JOIN bookmarks ON bookmarks.id = bookmarks_fts.id
      WHERE bookmarks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `,
    args: [match, limit],
  });
  return rs.rows.map((row) => ({ bookmark: rowToBookmark(row), score: -Number(row.rank) }));
}

/**
 * Minimum cosine similarity (1 - vector_distance_cos) a vector candidate must
 * reach to be considered a match AT ALL. Without a floor, a pure top-K nearest
 * -neighbour scan always returns K rows: search for "sourdough starter" in a
 * library of frontend docs and the frontend docs come back, because "closest"
 * says nothing about "close".
 *
 * CALIBRATED EMPIRICALLY (2026-08-13) against the local dev corpus (10 embedded
 * bookmarks — react.dev/nextjs.org/vercel.com/svelte.dev/vitejs.dev/expo.dev
 * docs + blogs) with the production embedding path (`gemini-embedding-001`,
 * 768 dims, L2-normalized). Best similarity per probe query:
 *
 *   SHOULD match        "svelte frontend framework blog"        0.8329
 *                       "next.js deployment on vercel"          0.6935
 *                       "react hooks tutorial"                  0.6638
 *   borderline          "kubernetes cluster autoscaling"        0.4915
 *                       "tax return deadline"                   0.4359
 *   SHOULD NOT match    "qwzx plorbnag flooble" (nonsense)      0.4689
 *                       "sourdough bread starter recipe"        0.4603
 *                       "1994 honda civic transmission fluid"   0.4273
 *
 * Note how high the junk baseline is: this model puts *unrelated* text at
 * ~0.40-0.49 rather than near 0, which is exactly why "top K by distance" felt
 * random. 0.55 sits above every non-matching probe (max 0.4915, ~0.06 margin)
 * and below every genuinely-matching one (min 0.6638, ~0.11 margin), and it
 * still keeps the weaker-but-real neighbours of a matching query (e.g.
 * reactnative.dev at 0.5598 for "react hooks tutorial") while dropping the
 * merely-same-genre ones (svelte.dev at 0.5299 for that query).
 *
 * Consequence, by design: a query with no keyword hits and nothing above the
 * floor returns NO results instead of plausible-looking noise.
 */
export const MIN_VECTOR_SIMILARITY = 0.55;

/** Cosine DISTANCE cutoff equivalent to `MIN_VECTOR_SIMILARITY` (SQL compares distance). */
const MAX_VECTOR_DISTANCE = 1 - MIN_VECTOR_SIMILARITY;

/**
 * Semantic search over stored embeddings using libSQL's native vector
 * functions. Cosine distance in [0, 2] is mapped to similarity = 1 - distance.
 *
 * The `MIN_VECTOR_SIMILARITY` floor is applied IN SQL rather than to the returned
 * rows. Both produce the same set (the ranking is ordered by that very distance,
 * so the floor only ever cuts a suffix), but in the query the DB stops
 * materializing and shipping rows the caller would immediately discard — and the
 * guarantee lives next to the scoring it constrains instead of in every caller.
 */
export async function searchVector(db: Db, embedding: number[], limit: number): Promise<Scored[]> {
  const vector = JSON.stringify(embedding);
  const rs = await db.execute({
    sql: `
      SELECT ${BOOKMARK_COLUMNS},
             vector_distance_cos(embedding, vector32(?)) AS distance
      FROM bookmarks
      WHERE embedding IS NOT NULL
        AND vector_distance_cos(embedding, vector32(?)) <= ?
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: [vector, vector, MAX_VECTOR_DISTANCE, limit],
  });
  return rs.rows.map((row) => ({
    bookmark: rowToBookmark(row),
    score: 1 - Number(row.distance),
  }));
}

/**
 * Blend a full-text and a semantic result list with Reciprocal Rank Fusion:
 * score(d) = Σ 1/(K + rank_in_list). Rank-based, so the incomparable bm25
 * and cosine scales never fight; documents found by BOTH lists rise to the
 * top, and K=60 (the standard constant) keeps single-list hits competitive.
 *
 * `limit` is optional: omit it to get the WHOLE fused ranking (the union of both
 * lists, best first), which is what a paging caller needs — it has to cut a
 * window out of the merged order, and it can only do that once the merge has
 * seen every candidate. Passing a limit truncates, exactly as before.
 */
export function mergeHybrid(
  textResults: Scored[],
  vectorResults: Scored[],
  limit?: number,
): Scored[] {
  const K = 60;
  const merged = new Map<string, Scored>();
  for (const list of [textResults, vectorResults]) {
    const exact = list === textResults;
    list.forEach(({ bookmark }, index) => {
      const contribution = 1 / (K + index + 1);
      const existing = merged.get(bookmark.id);
      if (existing) {
        existing.score += contribution;
        if (exact) existing.exact = true;
      } else {
        merged.set(bookmark.id, { bookmark, score: contribution, exact });
      }
    });
  }
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

/** Store the embedding for a bookmark (marks it searchable by AI). */
export async function storeEmbedding(db: Db, id: string, embedding: number[]): Promise<void> {
  await db.execute({
    sql: "UPDATE bookmarks SET embedding = vector32(?) WHERE id = ?",
    args: [JSON.stringify(embedding), id],
  });
}

/** Bookmarks still waiting for an embedding (used by the embed worker). */
export async function listUnembedded(db: Db, limit = 20): Promise<Bookmark[]> {
  const rs = await db.execute({
    sql: `SELECT ${BOOKMARK_COLUMNS} FROM bookmarks WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map(rowToBookmark);
}

/**
 * Sanitize free text into an FTS5 query: bare terms, prefix-matched, ANDed.
 * Strips FTS operators so user input can never produce a syntax error.
 */
function toFtsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}
