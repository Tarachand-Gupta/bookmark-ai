import { describe, expect, it } from "vitest";
import { BACKFILL_MAX_AGE_MS, isBackfilledNode } from "./native-sync-import";

/**
 * Firefox has no `bookmarks.onImportBegan/onImportEnded`, so the mirror relies
 * on a node's `dateAdded` to tell a live add from an import/restore/sync
 * backfill (see lib/native-sync-import.ts).
 */
describe("isBackfilledNode", () => {
  const now = 1_800_000_000_000;

  it("treats a node created just now as a live add", () => {
    expect(isBackfilledNode(now, now)).toBe(false);
    expect(isBackfilledNode(now - 5_000, now)).toBe(false);
    expect(isBackfilledNode(now - BACKFILL_MAX_AGE_MS, now)).toBe(false); // boundary: not older than
  });

  it("treats a node created well before we heard about it as backfill", () => {
    expect(isBackfilledNode(now - BACKFILL_MAX_AGE_MS - 1, now)).toBe(true);
    expect(isBackfilledNode(now - 3 * 24 * 60 * 60 * 1000, now)).toBe(true); // a restore from Tuesday
  });

  it("never skips when the timestamp is unknown or nonsensical", () => {
    expect(isBackfilledNode(undefined, now)).toBe(false);
    expect(isBackfilledNode(Number.NaN, now)).toBe(false);
    expect(isBackfilledNode(now + 60_000, now)).toBe(false); // clock skew into the future
  });

  it("honors a custom window", () => {
    expect(isBackfilledNode(now - 2_000, now, 1_000)).toBe(true);
    expect(isBackfilledNode(now - 500, now, 1_000)).toBe(false);
  });
});
