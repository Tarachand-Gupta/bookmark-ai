import { describe, expect, it } from "vitest";
import { runBulk } from "./bulk";

/**
 * The regression these cover: the bulk-delete dialog sat at "Deleted 0 of N" for
 * the whole run. The counter has to advance once per SETTLED request — including
 * the ones that reject — and the batch has to keep going after a failure so the
 * summary can report a partial success.
 */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("runBulk", () => {
  it("reports a monotonic count, once per id, ending at the total", async () => {
    const seen: number[] = [];
    const result = await runBulk(ids(10), async () => {}, {
      concurrency: 3,
      onSettled: (done) => seen.push(done),
    });

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result).toEqual({ done: 10, failed: 0, firstError: null });
  });

  it("counts failures without aborting the batch, and keeps the first message", async () => {
    const attempted: string[] = [];
    const seen: number[] = [];
    const result = await runBulk(
      ids(6),
      async (id) => {
        attempted.push(id);
        if (id === "id-1") throw new Error("first boom");
        if (id === "id-4") throw new Error("second boom");
      },
      { concurrency: 1, onSettled: (done) => seen.push(done) },
    );

    expect(attempted).toHaveLength(6);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result).toEqual({ done: 6, failed: 2, firstError: "first boom" });
  });

  it("never runs more than `concurrency` requests at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk(
      ids(20),
      async () => {
        peak = Math.max(peak, ++inFlight);
        await Promise.resolve();
        inFlight--;
      },
      { concurrency: 4 },
    );

    expect(peak).toBe(4);
  });

  it("does not spawn more workers than there are ids", async () => {
    const seen: number[] = [];
    const result = await runBulk(ids(2), async () => {}, {
      concurrency: 6,
      onSettled: (done) => seen.push(done),
    });

    expect(seen).toEqual([1, 2]);
    expect(result.done).toBe(2);
  });

  it("handles an empty batch", async () => {
    const seen: number[] = [];
    const result = await runBulk([], async () => {}, {
      concurrency: 6,
      onSettled: (done) => seen.push(done),
    });

    expect(seen).toEqual([]);
    expect(result).toEqual({ done: 0, failed: 0, firstError: null });
  });
});
