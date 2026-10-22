import { describe, expect, it, vi } from "vitest";
import type { OrganizationOperation } from "@bookmark-ai/types";
import { batchStorageKey, createBatchJob, writeBatchJob } from "./organization-batches";
import { bulkChangeDescription, bulkDestination, clearCompletedBulkJob, readPendingBulkJob, recoverBulkJob, reserveBulkJob, saveOwnedBulkJob } from "./bulk-editor-state";
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const receipt = (id: string): OrganizationOperation => ({ id, action: "bookmarks.update", description: "Move", createdAt: "2026-10-16", undoExpiresAt: "2026-10-23", status: "completed", requestedCount: 1, succeededCount: 1, failedCount: 0, results: [], undoStatus: "available" });
const missing = () => Object.assign(new Error("Not found"), { status: 404 });
const deps = () => ({ apply: vi.fn(async (input: { operationId: string }) => ({ operation: receipt(input.operationId) })), reconcile: vi.fn(async (id: string) => ({ operation: receipt(id) })), save: vi.fn(), shouldPause: () => false, onReceipt: vi.fn() });
describe("bulk editor recovery", () => {
  it("keeps the new draft separate from the prior saved selection and destination", () => {
    const store = storage(); const prior = createBatchJob("a", ["old"], { folderId: "old-folder" }); reserveBulkJob(store, prior);
    const draft = createBatchJob("a", ["new"], { folderId: "new-folder" });
    expect(readPendingBulkJob(store, "a")).toEqual(prior);
    expect(() => reserveBulkJob(store, draft)).toThrow("Resolve the saved change");
    expect(readPendingBulkJob(store, "a")).toEqual(prior);
    expect(draft.bookmarkIds).toEqual(["new"]); expect(draft.changes.folderId).toBe("new-folder");
  });
  it("isolates accounts and blocks overwrite of unreadable recovery data", () => {
    const store = storage(); reserveBulkJob(store, createBatchJob("a", ["old"], { folderId: null }));
    expect(readPendingBulkJob(store, "b")).toBeNull(); reserveBulkJob(store, createBatchJob("b", ["new"], { folderId: null }));
    store.setItem(batchStorageKey("a"), "unreadable");
    expect(() => readPendingBulkJob(store, "a")).toThrow("could not be read");
    expect(() => reserveBulkJob(store, createBatchJob("a", ["new"], { folderId: null }))).toThrow();
    expect(store.getItem(batchStorageKey("a"))).toBe("unreadable");
  });
  it("never saves over or clears a different operation, or clears unconfirmed IDs", () => {
    const store = storage(); const old = createBatchJob("a", ["old"], { folderId: null }); const newer = createBatchJob("a", ["new"], { folderId: null });
    reserveBulkJob(store, old); old.state = "unknown"; clearCompletedBulkJob(store, old); expect(readPendingBulkJob(store, "a")?.id).toBe(old.id);
    writeBatchJob(store, newer); old.state = "complete"; old.batches[0].receipt = receipt(old.batches[0].operationId);
    expect(() => saveOwnedBulkJob(store, old)).toThrow("has changed"); clearCompletedBulkJob(store, old); expect(readPendingBulkJob(store, "a")?.id).toBe(newer.id);
    newer.state = "complete"; clearCompletedBulkJob(store, newer); expect(readPendingBulkJob(store, "a")).not.toBeNull();
    newer.batches[0].receipt = receipt(newer.batches[0].operationId); clearCompletedBulkJob(store, newer); expect(readPendingBulkJob(store, "a")).toBeNull();
  });
  it("reserves Unsorted for null and rejects a deleted destination for new applies", () => {
    const data = { folders: [], categories: [] };
    expect(bulkDestination("move", null, data)).toEqual({ valid: true, label: "Unsorted" });
    expect(bulkDestination("move", "deleted", data)).toEqual({ valid: false, label: "Folder no longer available" });
    expect(bulkDestination("move", undefined, data).valid).toBe(false);
    expect(bulkChangeDescription({ folderId: "deleted" }, data)).toBe("Move to Folder no longer available");
  });
  it("reconciles original IDs before replaying the exact payload and expected versions", async () => {
    const job = createBatchJob("a", ["one", "two"], { folderId: "original" }, 1, { two: { folderId: "0" } }); job.state = "unknown";
    const dependencies = deps(); const order: string[] = [];
    dependencies.reconcile.mockImplementation(async id => { order.push(`get:${id}`); if (id === job.batches[1].operationId) throw missing(); return { operation: receipt(id) }; });
    dependencies.apply.mockImplementation(async input => { order.push(`post:${input.operationId}`); return { operation: receipt(input.operationId) }; });
    await recoverBulkJob(job, true, dependencies);
    expect(order).toEqual([`get:${job.batches[0].operationId}`, `get:${job.batches[1].operationId}`, `post:${job.batches[1].operationId}`]);
    expect(dependencies.apply).toHaveBeenCalledWith({ operationId: job.batches[1].operationId, action: "bookmarks.update", bookmarkIds: ["two"], changes: { folderId: "original" }, expected: { two: { folderId: "0" } } });
    expect(job.state).toBe("complete");
  });
  it("does not send or discard unknown IDs when reconciliation is unavailable", async () => {
    const job = createBatchJob("a", ["one"], { folderId: "original" }); const identity = job.batches[0].operationId; const dependencies = deps();
    dependencies.reconcile.mockRejectedValue(new Error("offline")); await recoverBulkJob(job, true, dependencies);
    expect(dependencies.apply).not.toHaveBeenCalled(); expect(job.state).toBe("unknown"); expect(job.batches[0].operationId).toBe(identity); expect(job.changes.folderId).toBe("original");
  });
  it("can reconcile a completed move even after its folder is deleted", async () => {
    const job = createBatchJob("a", ["one"], { folderId: "deleted" }); const dependencies = deps();
    await recoverBulkJob(job, false, dependencies); expect(job.state).toBe("complete"); expect(dependencies.apply).not.toHaveBeenCalled(); expect(job.changes.folderId).toBe("deleted");
  });
  it("keeps missing-folder unresolved groups and original payload without replay", async () => {
    const job = createBatchJob("a", ["one"], { folderId: "deleted" }); const dependencies = deps(); dependencies.reconcile.mockRejectedValue(missing());
    await recoverBulkJob(job, false, dependencies); expect(job.state).toBe("paused"); expect(job.error).toContain("original IDs and payload"); expect(dependencies.apply).not.toHaveBeenCalled(); expect(job.changes.folderId).toBe("deleted");
  });
  it("finishes cleanup after a reload of an already-complete saved change", async () => {
    const store = storage(); const job = createBatchJob("a", ["one"], { folderId: "deleted" });
    job.batches[0].receipt = receipt(job.batches[0].operationId); job.state = "complete"; reserveBulkJob(store, job);
    const dependencies = { ...deps(), save: vi.fn((next: typeof job) => saveOwnedBulkJob(store, next)) };
    await recoverBulkJob(job, false, dependencies); clearCompletedBulkJob(store, job);
    expect(readPendingBulkJob(store, "a")).toBeNull(); expect(dependencies.reconcile).not.toHaveBeenCalled(); expect(dependencies.apply).not.toHaveBeenCalled();
  });
  it("honors close while a reconciliation request is in flight", async () => {
    const job = createBatchJob("a", ["one", "two"], { folderId: null }, 1); const dependencies = deps(); let paused = false;
    dependencies.shouldPause = () => paused; dependencies.reconcile.mockImplementation(async id => { paused = true; return { operation: receipt(id) }; });
    await recoverBulkJob(job, true, dependencies); expect(job.state).toBe("paused"); expect(job.batches[0].receipt).toBeDefined(); expect(job.batches[1].receipt).toBeUndefined(); expect(dependencies.apply).not.toHaveBeenCalled(); expect(dependencies.reconcile).toHaveBeenCalledTimes(1);
  });
});
