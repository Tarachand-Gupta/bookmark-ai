import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  createSession,
  ensureSchema,
  insertBookmark,
  searchSessions,
  searchSessionsVector,
  searchVector,
  storeEmbedding,
  storeSessionEmbedding,
  MIN_VECTOR_SIMILARITY,
  SESSION_SCORE_SELF,
  SESSION_SCORE_TABS,
  type Db,
} from "@bookmark-ai/db";
import { mergeSessionResults, performSearch } from "@bookmark-ai/engine";
import type { Source } from "@bookmark-ai/types";

/**
 * Relevance behavior of search: the vector similarity FLOOR, per-term saved
 * session matching, and how the two kinds of session hit are merged.
 *
 * Unlike search-paging.test.ts (which fakes the retrieval queries to isolate the
 * fusion), these run against a REAL in-memory libSQL database with the real
 * schema — `@libsql/client`'s in-memory mode supports `vector32()`,
 * `vector_distance_cos()` and even `libsql_vector_idx()`, so the floor and the
 * LIKE clauses are exercised as the SQL the server actually ships, not as a
 * TypeScript re-implementation of them. It stays in apps/web because that is the
 * one workspace with a test runner.
 */

const DIM = 768; // EMBEDDING_DIM — hard-coded so a change to it fails loudly here.

/**
 * A unit vector whose cosine similarity to `PROBE` is exactly `similarity`:
 * everything lives in the first two coordinates, so sim = cos θ by construction.
 * That makes "0.54 is below the floor, 0.56 is above it" an exact statement
 * rather than a guess about what an embedding model would produce.
 */
function vectorAt(similarity: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[0] = similarity;
  v[1] = Math.sqrt(1 - similarity * similarity);
  return v;
}
const PROBE = vectorAt(1);

const source: Source = {
  browser: "chrome",
  device: "desktop",
  deviceName: null,
  os: null,
  savedAt: "2026-08-01T10:00:00.000Z",
};

async function freshDb(): Promise<Db> {
  const db = createDb(":memory:");
  await ensureSchema(db);
  return db;
}

/** A bookmark plus a stored embedding at an exact similarity to `PROBE`. */
async function seedBookmark(db: Db, id: string, title: string, similarity: number) {
  await insertBookmark(db, {
    id,
    url: `https://example.com/${id}`,
    domain: "example.com",
    title,
    description: null,
    og: {},
    source,
    category: "Development",
    tags: [],
    createdAt: source.savedAt,
  });
  await storeEmbedding(db, id, vectorAt(similarity));
}

async function seedSession(
  db: Db,
  s: { id: string; name: string; description?: string | null; tabs: string[]; createdAt?: string },
) {
  await createSession(db, {
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    tabs: s.tabs.map((title, i) => ({ url: `https://example.com/tab/${i}`, title })),
    browser: "chrome",
    device: "desktop",
    os: null,
    savedAt: s.createdAt ?? "2026-08-01T10:00:00.000Z",
    createdAt: s.createdAt ?? "2026-08-01T10:00:00.000Z",
  });
}

/** A Gemini stand-in that always returns the probe vector. */
const gemini = {
  embed: async () => PROBE,
} as unknown as Parameters<typeof performSearch>[1];

describe("searchVector — the similarity floor", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    // Straddling the floor on both sides, plus one obvious match and one obvious
    // junk row — the shape of a real query against a real library.
    await seedBookmark(db, "strong", "Very close", 0.9);
    await seedBookmark(db, "just-above", "Just above the floor", MIN_VECTOR_SIMILARITY + 0.01);
    await seedBookmark(db, "just-below", "Just below the floor", MIN_VECTOR_SIMILARITY - 0.01);
    await seedBookmark(db, "junk", "Nothing to do with it", 0.2);
  });

  it("keeps candidates at or above the floor and drops the rest", async () => {
    const results = await searchVector(db, PROBE, 10);
    expect(results.map((r) => r.bookmark.id)).toEqual(["strong", "just-above"]);
    // Scores are still the similarity, unchanged by the filtering.
    expect(results[0].score).toBeCloseTo(0.9, 4);
    expect(results[1].score).toBeCloseTo(MIN_VECTOR_SIMILARITY + 0.01, 4);
  });

  it("returns NOTHING rather than the nearest junk when nothing clears the floor", async () => {
    const onlyJunk = await freshDb();
    await seedBookmark(onlyJunk, "junk-a", "Unrelated A", 0.44);
    await seedBookmark(onlyJunk, "junk-b", "Unrelated B", 0.49);
    expect(await searchVector(onlyJunk, PROBE, 10)).toEqual([]);
  });

  it("holds the floor under a tight limit", async () => {
    // A limit smaller than the candidate count must not become a reason to admit
    // a below-floor row to fill the page.
    expect((await searchVector(db, PROBE, 3)).map((r) => r.bookmark.id)).toEqual([
      "strong",
      "just-above",
    ]);
    expect((await searchVector(db, PROBE, 1)).map((r) => r.bookmark.id)).toEqual(["strong"]);
  });

  it("empties an ai-mode search whose only candidates are below the floor", async () => {
    const onlyJunk = await freshDb();
    await seedBookmark(onlyJunk, "junk-a", "Unrelated A", 0.4);
    const res = await performSearch(onlyJunk, gemini, { q: "sourdough", mode: "ai", limit: 20 });
    expect(res.mode).toBe("ai");
    expect(res.results).toEqual([]);
  });

  it("still returns keyword hits in hybrid mode when the vector side is all junk", async () => {
    const onlyJunk = await freshDb();
    await seedBookmark(onlyJunk, "junk-a", "Sourdough starter guide", 0.4);
    const res = await performSearch(onlyJunk, gemini, { q: "sourdough", mode: "hybrid", limit: 20 });
    expect(res.results.map((r) => r.bookmark.id)).toEqual(["junk-a"]);
    expect(res.results[0].exact).toBe(true);
  });
});

describe("searchSessionsVector — the same floor over saved sessions", () => {
  it("filters session candidates by similarity too", async () => {
    const db = await freshDb();
    await seedSession(db, { id: "close", name: "Close session", tabs: ["a"] });
    await seedSession(db, { id: "far", name: "Far session", tabs: ["b"] });
    await storeSessionEmbedding(db, "close", vectorAt(0.8));
    await storeSessionEmbedding(db, "far", vectorAt(0.3));

    const results = await searchSessionsVector(db, PROBE, 5);
    expect(results.map((r) => r.session.id)).toEqual(["close"]);
    expect(results[0].score).toBeCloseTo(0.8, 4);
    expect(results[0].semantic).toBe(true);
  });

  it("ignores sessions whose vector has not been computed yet", async () => {
    const db = await freshDb();
    await seedSession(db, { id: "unembedded", name: "No vector yet", tabs: ["a"] });
    expect(await searchSessionsVector(db, PROBE, 5)).toEqual([]);
  });
});

describe("searchSessions — per-term text matching", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    await seedSession(db, {
      id: "named",
      name: "Rust: async runtimes compared",
      tabs: ["tokio docs", "smol readme"],
      createdAt: "2026-08-01T10:00:00.000Z",
    });
    await seedSession(db, {
      id: "described",
      name: "Aug 11, 1:22 am · 37 tabs",
      description: "Reading up on async runtimes in Rust and how they schedule tasks.",
      tabs: ["unrelated page"],
      createdAt: "2026-08-02T10:00:00.000Z",
    });
    await seedSession(db, {
      id: "tabs-only",
      name: "Tuesday morning",
      tabs: ["Rust async book", "runtimes benchmark"],
      createdAt: "2026-08-03T10:00:00.000Z",
    });
    await seedSession(db, {
      id: "split-tiers",
      // "rust" is in the NAME, "runtimes" only in a TAB — deliberately not a match.
      name: "Rust notes",
      tabs: ["comparing runtimes"],
      createdAt: "2026-08-04T10:00:00.000Z",
    });
    await seedSession(db, {
      id: "scattered",
      // All of "async"/"runtimes" present but never adjacent — and NEWER than
      // `named`, so only the phrase tiebreak can put `named` ahead of it.
      name: "Runtimes for background work, async where it helps",
      tabs: ["notes"],
      createdAt: "2026-08-05T10:00:00.000Z",
    });
  });

  it("matches every term separately instead of the whole phrase", async () => {
    // The old whole-phrase LIKE found NONE of these: no row contains the literal
    // string "rust runtimes".
    const results = await searchSessions(db, "rust runtimes", 10);
    expect(results.map((r) => r.session.id).sort()).toEqual(["described", "named", "tabs-only"]);
  });

  it("requires all terms within ONE tier — name-plus-tab is not a match", async () => {
    const results = await searchSessions(db, "rust runtimes", 10);
    expect(results.map((r) => r.session.id)).not.toContain("split-tiers");
  });

  it("keeps the two tiers: name/summary hits outrank tabs-only hits", async () => {
    const results = await searchSessions(db, "rust runtimes", 10);
    const tiers = results.map((r) => r.score);
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a)); // non-increasing
    const byId = new Map(results.map((r) => [r.session.id, r.score]));
    expect(byId.get("named")).toBe(SESSION_SCORE_SELF);
    expect(byId.get("described")).toBe(SESSION_SCORE_SELF);
    expect(byId.get("tabs-only")).toBe(SESSION_SCORE_TABS);
    expect(results.at(-1)?.session.id).toBe("tabs-only");
  });

  it("ranks a whole-phrase hit above a merely all-terms-present one", async () => {
    // `named` ("Rust: async runtimes compared"), `described` (summary contains
    // "async runtimes") and `scattered` are all session-tier hits for "async
    // runtimes", but only the first two contain it as a PHRASE — and `scattered`
    // is the newest, so the created_at tiebreak alone would have put it first.
    const results = await searchSessions(db, "async runtimes", 10);
    const sessionTier = results
      .filter((r) => r.score === SESSION_SCORE_SELF)
      .map((r) => r.session.id);
    expect(sessionTier.slice(0, 2).sort()).toEqual(["described", "named"]);
    expect(sessionTier.at(-1)).toBe("scattered");
  });

  it("still matches a single-term query", async () => {
    const results = await searchSessions(db, "tokio", 10);
    expect(results.map((r) => r.session.id)).toEqual(["named"]);
    expect(results[0].score).toBe(SESSION_SCORE_TABS);
  });

  it("treats LIKE wildcards in the query as literal text", async () => {
    // "%" would match every row if it reached SQL unescaped.
    expect(await searchSessions(db, "%", 10)).toEqual([]);
    expect(await searchSessions(db, "_ust", 10)).toEqual([]);
    await seedSession(db, { id: "literal", name: "100% coverage", tabs: ["x"] });
    const results = await searchSessions(db, "100%", 10);
    expect(results.map((r) => r.session.id)).toEqual(["literal"]);
  });

  it("returns nothing for a whitespace-only query", async () => {
    expect(await searchSessions(db, "   ", 10)).toEqual([]);
  });

  it("respects the limit", async () => {
    expect(await searchSessions(db, "rust runtimes", 2)).toHaveLength(2);
  });
});

describe("mergeSessionResults", () => {
  const s = (id: string, score: number, semantic?: boolean) => ({
    session: { id } as never,
    score,
    ...(semantic ? { semantic: true } : {}),
  });

  it("keeps text hits first, in their existing order", () => {
    const merged = mergeSessionResults(
      [s("t1", SESSION_SCORE_SELF), s("t2", SESSION_SCORE_TABS)],
      [s("v1", 0.9, true)],
      5,
    );
    expect(merged.map((r) => r.session.id)).toEqual(["t1", "t2", "v1"]);
  });

  it("dedupes a session found by both, keeping its text score", () => {
    const merged = mergeSessionResults(
      [s("both", SESSION_SCORE_TABS)],
      [s("both", 0.95, true), s("v1", 0.7, true)],
      5,
    );
    expect(merged.map((r) => r.session.id)).toEqual(["both", "v1"]);
    expect(merged[0].score).toBe(SESSION_SCORE_TABS);
    expect(merged[0].semantic).toBeUndefined();
  });

  it("orders the semantic remainder by similarity, best first", () => {
    const merged = mergeSessionResults([], [s("mid", 0.7, true), s("top", 0.9, true)], 5);
    expect(merged.map((r) => r.session.id)).toEqual(["top", "mid"]);
  });

  it("caps the merged list at the limit, never dropping a text hit for a vector one", () => {
    const merged = mergeSessionResults(
      [s("t1", 2), s("t2", 2), s("t3", 1)],
      [s("v1", 0.99, true), s("v2", 0.98, true)],
      4,
    );
    expect(merged.map((r) => r.session.id)).toEqual(["t1", "t2", "t3", "v1"]);
  });
});

describe("performSearch — sessionResults across the modes", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    // Matches by TEXT only.
    await seedSession(db, { id: "text-hit", name: "Rust async notes", tabs: ["tokio"] });
    // Matches by MEANING only (no query term appears in it).
    await seedSession(db, { id: "vector-hit", name: "Tuesday morning", tabs: ["a page"] });
    await storeSessionEmbedding(db, "vector-hit", vectorAt(0.85));
    // Embedded but nowhere near the query.
    await seedSession(db, { id: "far", name: "Groceries", tabs: ["list"] });
    await storeSessionEmbedding(db, "far", vectorAt(0.3));
  });

  it("hybrid mode merges text and semantic session hits", async () => {
    const res = await performSearch(db, gemini, { q: "rust async", mode: "hybrid", limit: 20 });
    expect(res.sessionResults?.map((r) => r.session.id)).toEqual(["text-hit", "vector-hit"]);
    expect(res.sessionResults?.[0].semantic).toBeUndefined();
    expect(res.sessionResults?.[1].semantic).toBe(true);
  });

  it("ai mode gets the same merged sessions", async () => {
    const res = await performSearch(db, gemini, { q: "rust async", mode: "ai", limit: 20 });
    expect(res.sessionResults?.map((r) => r.session.id)).toEqual(["text-hit", "vector-hit"]);
  });

  it("text mode stays text-only — no embedding, no semantic session hits", async () => {
    const res = await performSearch(db, null, { q: "rust async", mode: "text", limit: 20 });
    expect(res.sessionResults?.map((r) => r.session.id)).toEqual(["text-hit"]);
  });

  it("embeds the query ONCE and reuses it for the session vector search", async () => {
    let calls = 0;
    const counting = {
      embed: async () => {
        calls++;
        return PROBE;
      },
    } as unknown as Parameters<typeof performSearch>[1];
    await performSearch(db, counting, { q: "rust async", mode: "hybrid", limit: 20 });
    expect(calls).toBe(1);
  });
});
