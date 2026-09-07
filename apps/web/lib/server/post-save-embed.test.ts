import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDb,
  ensureSchema,
  getBookmark,
  insertBookmark,
  listUnembedded,
  storeEmbedding,
  type Db,
} from "@bookmark-ai/db";
import { embedBookmarkById, type GeminiClient } from "@bookmark-ai/engine";
import type { Source } from "@bookmark-ai/types";
import { embedAfterSave, STRAGGLER_LIMIT } from "@/lib/server/post-save-embed";

/**
 * The post-save embedding hook, against a REAL in-memory libSQL database with
 * the real schema (only Gemini is a stub — the whole point is which rows get a
 * vector and how many model calls that costs).
 *
 * The bug these lock down: the hook used to call `embedPending(gemini, db, 5)`,
 * which selects the 5 OLDEST unembedded rows. Under a burst of saves every
 * concurrent hook selected the SAME rows — production traces showed 64
 * `embed-sweep` spans each reporting `embedded: 5` on a 40-bookmark library that
 * ended with 16 vectors, i.e. ~320 embedding calls for 16 vectors, with 24 rows
 * left NULL until the next daily cron.
 */

const DIM = 768; // EMBEDDING_DIM — a change to it should fail loudly here.
const VECTOR = new Array<number>(DIM).fill(0).map((_, i) => (i === 0 ? 1 : 0));

const source: Source = {
  browser: "chrome",
  device: "desktop",
  deviceName: null,
  os: null,
  savedAt: "2026-09-03T10:00:00.000Z",
};

/** Counts calls, and yields the microtask queue so concurrent hooks interleave
 * the way they do around a real network round-trip. */
function stubGemini() {
  const embed = vi.fn(async () => {
    await Promise.resolve();
    return VECTOR;
  });
  return { gemini: { embed } as unknown as GeminiClient, embed };
}

async function freshDb(): Promise<Db> {
  const db = createDb(":memory:");
  await ensureSchema(db);
  return db;
}

/** A saved bookmark with NO embedding yet — what a post-save hook finds. */
async function seed(db: Db, id: string, minute = 0) {
  const at = `2026-09-03T10:${String(minute).padStart(2, "0")}:00.000Z`;
  return insertBookmark(db, {
    id,
    url: `https://example.com/${id}`,
    domain: "example.com",
    title: `Bookmark ${id}`,
    description: null,
    og: {},
    source: { ...source, savedAt: at },
    category: "Development",
    tags: ["test"],
    createdAt: at,
  });
}

describe("embedBookmarkById", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("embeds a pending row exactly once and reports it", async () => {
    const { gemini, embed } = stubGemini();
    await seed(db, "a");

    expect(await embedBookmarkById(gemini, db, "a")).toBe(true);
    expect(embed).toHaveBeenCalledTimes(1);
    expect((await getBookmark(db, "a"))?.embedded).toBe(true);
  });

  it("does nothing for a row that already has a vector", async () => {
    const { gemini, embed } = stubGemini();
    await seed(db, "a");
    await storeEmbedding(db, "a", VECTOR);

    expect(await embedBookmarkById(gemini, db, "a")).toBe(false);
    expect(embed).not.toHaveBeenCalled();
  });

  it("does nothing for a row that no longer exists", async () => {
    const { gemini, embed } = stubGemini();

    expect(await embedBookmarkById(gemini, db, "deleted-between-save-and-hook")).toBe(false);
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("embedAfterSave — burst of concurrent saves", () => {
  const N = 12;
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("gives every burst-saved row its own vector, at ~one embed call per save", async () => {
    const { gemini, embed } = stubGemini();
    const ids = Array.from({ length: N }, (_, i) => `b${i}`);
    for (const [i, id] of ids.entries()) await seed(db, id, i);

    // Every save's hook runs at once — the exact shape that made the old
    // oldest-first sweep embed the same 5 rows N times over.
    await Promise.all(ids.map((id) => embedAfterSave(gemini, db, id)));

    expect(await listUnembedded(db, N + 1)).toEqual([]);
    // N own-row embeds, plus at most one straggler per hook (which may duplicate
    // an in-flight row, never more than one).
    expect(embed.mock.calls.length).toBeGreaterThanOrEqual(N);
    expect(embed.mock.calls.length).toBeLessThanOrEqual(N * (1 + STRAGGLER_LIMIT));
  });

  it("still drains a straggler the burst left behind", async () => {
    const { gemini, embed } = stubGemini();
    await seed(db, "old", 0); // fell through an earlier save (no hook of its own)
    await seed(db, "new", 1);

    await embedAfterSave(gemini, db, "new");

    expect(await listUnembedded(db, 5)).toEqual([]);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("never throws when the model does", async () => {
    const gemini = { embed: vi.fn(async () => Promise.reject(new Error("429"))) };
    await seed(db, "a");

    await expect(
      embedAfterSave(gemini as unknown as GeminiClient, db, "a"),
    ).resolves.toBeUndefined();
    expect((await getBookmark(db, "a"))?.embedded).toBe(false);
  });
});
