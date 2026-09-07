import { describe, expect, it } from "vitest";
import {
  clampPageLimit,
  clampPageOffset,
  describePageRange,
  pageOf,
  TOOL_PAGE_LIMIT,
} from "@bookmark-ai/types";
import { countReadOnlySql, runReadOnlySql } from "@bookmark-ai/engine";
import type { Db } from "@bookmark-ai/db";

/**
 * The paging contract every list-shaped chat tool shares
 * (packages/types/src/chat-tools.ts) plus the engine's SQL half, which is what
 * keeps a `SELECT *` from flooding the model's context now that tool output is
 * no longer summarized for it.
 */

describe("chat tool paging helpers", () => {
  it("clamps a model-supplied limit into 1..TOOL_PAGE_LIMIT", () => {
    expect(clampPageLimit(undefined)).toBe(TOOL_PAGE_LIMIT);
    expect(clampPageLimit(10)).toBe(10);
    expect(clampPageLimit(0)).toBe(1);
    expect(clampPageLimit(-5)).toBe(1);
    expect(clampPageLimit(10_000)).toBe(TOOL_PAGE_LIMIT);
    expect(clampPageLimit(Number.NaN)).toBe(TOOL_PAGE_LIMIT);
    expect(clampPageLimit(7.9)).toBe(7);
  });

  it("clamps an offset to a non-negative integer", () => {
    expect(clampPageOffset(undefined)).toBe(0);
    expect(clampPageOffset(-4)).toBe(0);
    expect(clampPageOffset(51.7)).toBe(51);
  });

  it("slices consecutive pages that neither repeat nor skip", () => {
    const items = Array.from({ length: 92 }, (_, i) => i);
    const first = pageOf(items, 0, 50);
    expect(first.items).toHaveLength(50);
    expect(first.page).toEqual({ total: 92, offset: 0, limit: 50, hasMore: true, nextOffset: 50 });

    const second = pageOf(items, first.page.nextOffset!, 50);
    expect(second.items).toEqual(items.slice(50));
    expect(second.page).toEqual({ total: 92, offset: 50, limit: 50, hasMore: false, nextOffset: null });
    expect(new Set([...first.items, ...second.items]).size).toBe(92);
  });

  it("has no next page when the result fits in one, and is empty past the end", () => {
    expect(pageOf([1, 2, 3], 0, 50).page).toMatchObject({ hasMore: false, nextOffset: null });
    expect(pageOf([1, 2, 3], 100, 50).items).toEqual([]);
  });

  it("describes the range a card is showing", () => {
    expect(describePageRange({ total: 312, offset: 50, limit: 50, hasMore: true, nextOffset: 100 }, 50)).toBe("51–100 of 312");
    expect(describePageRange({ total: 8, offset: 0, limit: 50, hasMore: false, nextOffset: null }, 8)).toBe("1–8 of 8");
    // Ranked search has no total — the range still reads.
    expect(describePageRange({ total: null, offset: 0, limit: 50, hasMore: true, nextOffset: 50 }, 50)).toBe("1–50");
    expect(describePageRange({ total: 0, offset: 0, limit: 50, hasMore: false, nextOffset: null }, 0)).toBe("no rows");
  });
});

/** A libSQL-shaped stub that records the SQL it was handed. */
function stubDb(rowsFor: (sql: string) => unknown[][], columns = ["id", "title"]) {
  const seen: string[] = [];
  const db = {
    execute: async (sql: string) => {
      seen.push(sql);
      const rows = rowsFor(sql);
      return { columns, rows, rowsAffected: 0, lastInsertRowid: undefined, columnTypes: [] };
    },
  } as unknown as Db;
  return { db, seen };
}

describe("runReadOnlySql — paging", () => {
  const bigTable = (n: number) => Array.from({ length: n }, (_, i) => [i, `Row ${i}`]);

  it("wraps the agent's SELECT in LIMIT/OFFSET and reports the next page", async () => {
    // The runner fetches limit+1 to detect `hasMore` without a second query.
    const { db, seen } = stubDb(() => bigTable(51));
    const res = await runReadOnlySql(db, "SELECT id, title FROM bookmarks", { limit: 50, offset: 0 });
    expect(seen[0]).toContain("LIMIT 51 OFFSET 0");
    expect(res.rows).toHaveLength(50);
    expect(res.hasMore).toBe(true);
    expect(res.nextOffset).toBe(50);
    expect(res.offset).toBe(0);
  });

  it("ends the run when the last page comes back short", async () => {
    const { db } = stubDb(() => bigTable(12));
    const res = await runReadOnlySql(db, "SELECT id, title FROM bookmarks", { limit: 50, offset: 50 });
    expect(res.rows).toHaveLength(12);
    expect(res.hasMore).toBe(false);
    expect(res.nextOffset).toBeNull();
    expect(res.offset).toBe(50);
  });

  it("counts the true total when asked, without returning those rows", async () => {
    const { db, seen } = stubDb((sql) => (sql.includes("COUNT(*)") ? [[312]] : bigTable(51)));
    const res = await runReadOnlySql(db, "SELECT id, title FROM bookmarks", {
      limit: 50,
      offset: 0,
      countTotal: true,
    });
    expect(res.total).toBe(312);
    expect(res.rows).toHaveLength(50);
    expect(seen.some((s) => s.includes("SELECT COUNT(*) AS n FROM ("))).toBe(true);
  });

  it("keeps the read-only guards on the COUNT path too", async () => {
    const { db } = stubDb(() => [[0]]);
    await expect(countReadOnlySql(db, "DELETE FROM bookmarks")).rejects.toThrow();
    await expect(
      runReadOnlySql(db, "SELECT 1; DROP TABLE bookmarks", { limit: 50 }),
    ).rejects.toThrow();
  });

  it("strips the query's own trailing semicolon before wrapping", async () => {
    const { db, seen } = stubDb(() => []);
    await runReadOnlySql(db, "SELECT 1;  ", { limit: 5, offset: 10 });
    expect(seen[0]).toBe("SELECT * FROM (\nSELECT 1\n) LIMIT 6 OFFSET 10");
  });
});
