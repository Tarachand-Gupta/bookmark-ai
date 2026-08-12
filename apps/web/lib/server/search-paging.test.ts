import { describe, expect, it, vi } from "vitest";
import type { Bookmark, Session } from "@bookmark-ai/types";
import type { Scored, ScoredSession } from "@bookmark-ai/db";

/**
 * Paging behavior of the engine's `performSearch`.
 *
 * It lives here, next to the other server unit tests, because `packages/*` has no
 * test runner of its own — apps/web is the one workspace with vitest, and it
 * already depends on both the engine and the db package. Only the two retrieval
 * queries and the session query are faked; the Reciprocal Rank Fusion that
 * decides the order (`mergeHybrid`) is the REAL one, since the whole point of
 * these tests is that a page is cut out of the FUSED ranking rather than out of
 * either candidate list.
 */

/** Synthetic ranked lists: `p1…pN` for the keyword list, `v1…vN` for the vector
 * one, with an overlap so RRF has something to actually fuse. */
function scored(ids: string[]): Scored[] {
  return ids.map((id, i) => ({ bookmark: { id } as Bookmark, score: 1 - i / 100 }));
}

const TEXT_IDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const VECTOR_IDS = ["c", "a", "k", "l", "m", "n", "o", "p", "q", "r"];

const searchFullText = vi.fn(async (_db: unknown, _q: string, limit: number) =>
  scored(TEXT_IDS.slice(0, limit)),
);
const searchVector = vi.fn(async (_db: unknown, _v: number[], limit: number) =>
  scored(VECTOR_IDS.slice(0, limit)),
);
// Signatures spelled out (not `async () => []`) so `mock.calls[i][2]` — the limit
// these are asked for — is typed and assertable.
const searchSessions = vi.fn(async (_db: unknown, _q: string, _limit: number) => [] as ScoredSession[]);
const searchSessionsVector = vi.fn(
  async (_db: unknown, _v: number[], _limit: number) => [] as ScoredSession[],
);

vi.mock("@bookmark-ai/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bookmark-ai/db")>();
  return { ...actual, searchFullText, searchVector, searchSessions, searchSessionsVector };
});

const { performSearch, SESSION_RESULT_LIMIT } = await import("@bookmark-ai/engine");
const { mergeHybrid } = await import("@bookmark-ai/db");

/** A Gemini stand-in: `performSearch` only ever asks it to embed the query. */
const gemini = {
  embed: async () => [0.1, 0.2, 0.3],
} as unknown as Parameters<typeof performSearch>[1];

const db = {} as Parameters<typeof performSearch>[0];
const ids = (r: { results: Scored[] }) => r.results.map(({ bookmark }) => bookmark.id);

describe("performSearch — no offset (the pre-paging contract)", () => {
  it("keeps the response shape and the retrieval depth unchanged", async () => {
    searchFullText.mockClear();
    const res = await performSearch(db, null, { q: "x", mode: "text", limit: 3 });
    // No extra row: the query asked for exactly `limit`, as it always did.
    expect(searchFullText.mock.calls.at(-1)?.[2]).toBe(3);
    expect(ids(res)).toEqual(["a", "b", "c"]);
    // The paging fields must be ABSENT, not false/0 — clients (and the baseline
    // diff in docs/features/mcp.md) compare the serialized response.
    expect(Object.keys(res)).toEqual(["mode", "results", "sessionResults"]);
  });

  it("hybrid still returns the top `limit` of the fused ranking", async () => {
    const res = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 4 });
    const expected = mergeHybrid(scored(TEXT_IDS.slice(0, 4)), scored(VECTOR_IDS.slice(0, 4)), 4);
    expect(ids(res)).toEqual(expected.map(({ bookmark }) => bookmark.id));
    expect(res.offset).toBeUndefined();
    expect(res.hasMore).toBeUndefined();
  });
});

describe("performSearch — hybrid paging", () => {
  it("fetches BOTH candidate lists to the page's full depth before fusing", async () => {
    searchFullText.mockClear();
    searchVector.mockClear();
    await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 3, offset: 3 });
    // depth = offset + limit = 6, plus the one probe row that answers hasMore.
    expect(searchFullText.mock.calls.at(-1)?.[2]).toBe(7);
    expect(searchVector.mock.calls.at(-1)?.[2]).toBe(7);
  });

  it("serves consecutive, disjoint pages that reassemble the fused ranking", async () => {
    const page1 = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 3, offset: 0 });
    const page2 = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 3, offset: 3 });

    expect(page1.offset).toBe(0);
    expect(page2.offset).toBe(3);
    expect(ids(page1)).toHaveLength(3);
    expect(ids(page2)).toHaveLength(3);
    expect(ids(page1).filter((id) => ids(page2).includes(id))).toEqual([]);

    // Page 2 is the SAME ranking continued: fusing both lists at page 2's depth
    // and slicing [3,6) has to reproduce it exactly — that is what an SQL OFFSET
    // on either candidate list would get wrong.
    const fused = mergeHybrid(scored(TEXT_IDS.slice(0, 7)), scored(VECTOR_IDS.slice(0, 7)));
    expect(ids(page2)).toEqual(fused.slice(3, 6).map(({ bookmark }) => bookmark.id));
    // Overlapping ids ("a", "c") appear in both candidate lists, so a naive
    // per-list offset would have leaked them onto page 2.
    expect(ids(page2)).not.toContain("a");
    expect(ids(page2)).not.toContain("c");
  });

  it("reports hasMore until the ranking runs out", async () => {
    // 10 + 10 candidates with 2 shared ids = 18 distinct results.
    const early = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 5, offset: 0 });
    expect(early.hasMore).toBe(true);
    const last = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 5, offset: 15 });
    expect(last.hasMore).toBe(false);
    expect(ids(last)).toHaveLength(3);
    const past = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 5, offset: 40 });
    expect(past.results).toEqual([]);
    expect(past.hasMore).toBe(false);
  });

  it("degrades to keyword-only paging when embedding fails", async () => {
    searchVector.mockRejectedValueOnce(new Error("no vectors"));
    const res = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 3, offset: 3 });
    expect(res.fallback).toBe(true);
    expect(ids(res)).toEqual(["d", "e", "f"]);
    expect(res.hasMore).toBe(true);
  });
});

describe("performSearch — text and ai paging", () => {
  it("slices the keyword ranking", async () => {
    const res = await performSearch(db, null, { q: "x", mode: "text", limit: 4, offset: 4 });
    expect(ids(res)).toEqual(["e", "f", "g", "h"]);
    expect(res.offset).toBe(4);
    expect(res.hasMore).toBe(true);
    const tail = await performSearch(db, null, { q: "x", mode: "text", limit: 4, offset: 8 });
    expect(ids(tail)).toEqual(["i", "j"]);
    expect(tail.hasMore).toBe(false);
  });

  it("slices the vector ranking", async () => {
    const res = await performSearch(db, gemini, { q: "x", mode: "ai", limit: 2, offset: 2 });
    expect(res.mode).toBe("ai");
    expect(ids(res)).toEqual(["k", "l"]);
    expect(res.hasMore).toBe(true);
  });

  it("caps total retrieval depth", async () => {
    searchFullText.mockClear();
    // 190 + 40 would be 230; the engine clamps the depth it asks the db for.
    await performSearch(db, null, { q: "x", mode: "text", limit: 40, offset: 190 });
    expect(searchFullText.mock.calls.at(-1)?.[2]).toBe(201);
  });
});

describe("performSearch — sessionResults ride every page", () => {
  const session = (id: string) => ({ session: { id } as Session, score: 2 });

  it("asks for the same fixed handful of sessions whatever the page", async () => {
    searchSessions.mockClear();
    searchSessionsVector.mockClear();
    await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 40, offset: 120 });
    // Not `depth`: sessions are deliberately unpaged, so both session queries ask
    // for SESSION_RESULT_LIMIT rows no matter how deep the bookmark page is.
    expect(searchSessions.mock.calls.at(-1)?.[2]).toBe(SESSION_RESULT_LIMIT);
    expect(searchSessionsVector.mock.calls.at(-1)?.[2]).toBe(SESSION_RESULT_LIMIT);
  });

  it("skips the session vector search when no query embedding exists", async () => {
    searchSessionsVector.mockClear();
    await performSearch(db, null, { q: "x", mode: "text", limit: 5 });
    expect(searchSessionsVector).not.toHaveBeenCalled();
  });

  it("survives a failing session vector search with the text hits alone", async () => {
    searchSessions.mockResolvedValueOnce([session("s1")]);
    searchSessionsVector.mockRejectedValueOnce(new Error("no vector support"));
    const res = await performSearch(db, gemini, { q: "x", mode: "hybrid", limit: 5 });
    expect(res.sessionResults?.map((r) => r.session.id)).toEqual(["s1"]);
  });

  it("keeps sessions text-only when the query embedding itself failed", async () => {
    searchSessionsVector.mockClear();
    searchSessions.mockResolvedValueOnce([session("s1")]);
    const broken = { embed: async () => Promise.reject(new Error("no key")) } as unknown as
      typeof gemini;
    const res = await performSearch(db, broken, { q: "x", mode: "hybrid", limit: 5 });
    expect(res.fallback).toBe(true);
    expect(searchSessionsVector).not.toHaveBeenCalled();
    expect(res.sessionResults?.map((r) => r.session.id)).toEqual(["s1"]);
  });
});
