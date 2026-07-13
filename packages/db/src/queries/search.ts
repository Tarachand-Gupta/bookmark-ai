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
 * Semantic search over stored embeddings using libSQL's native vector
 * functions. Cosine distance in [0, 2] is mapped to similarity = 1 - distance.
 */
export async function searchVector(db: Db, embedding: number[], limit: number): Promise<Scored[]> {
  const vector = JSON.stringify(embedding);
  const rs = await db.execute({
    sql: `
      SELECT ${BOOKMARK_COLUMNS},
             vector_distance_cos(embedding, vector32(?)) AS distance
      FROM bookmarks
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: [vector, limit],
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
 */
export function mergeHybrid(
  textResults: Scored[],
  vectorResults: Scored[],
  limit: number,
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
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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
