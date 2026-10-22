import type { BulkBookmarkChanges, OrganizationOperation, OrganizationOperationInput } from "@bookmark-ai/types";
export interface OrganizationBatchJob {
  version: 1; accountId: string; id: string; bookmarkIds: string[]; changes: BulkBookmarkChanges;
  expected?: Record<string, Record<string, string>>;
  batches: { operationId: string; bookmarkIds: string[]; receipt?: OrganizationOperation }[];
  state: "ready" | "running" | "paused" | "unknown" | "complete"; error?: string;
}
export const batchStorageKey = (accountId: string) => `bmai:organization-batches:v1:${accountId}`;
export function createBatchJob(accountId: string, bookmarkIds: string[], changes: BulkBookmarkChanges, maxItems = 500, expected?: Record<string, Record<string, string>>): OrganizationBatchJob {
  const ids = [...new Set(bookmarkIds)];
  if (!ids.length || ids.length > 10000) throw new Error("Select between 1 and 10,000 bookmarks.");
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 500) throw new Error("Invalid batch size.");
  const batches = [];
  for (let offset = 0; offset < ids.length; offset += maxItems) batches.push({ operationId: crypto.randomUUID(), bookmarkIds: ids.slice(offset, offset + maxItems) });
  return { version: 1, accountId, id: crypto.randomUUID(), bookmarkIds: ids, changes: structuredClone(changes), expected: expected ? structuredClone(expected) : undefined, batches, state: "ready" };
}
export function readBatchJob(storage: Pick<Storage, "getItem">, accountId: string): OrganizationBatchJob | null {
  try { const job = JSON.parse(storage.getItem(batchStorageKey(accountId)) ?? "null") as OrganizationBatchJob | null; return job?.version === 1 && job.accountId === accountId && Array.isArray(job.bookmarkIds) && job.bookmarkIds.length > 0 && job.bookmarkIds.length <= 10000 && job.bookmarkIds.every(id => typeof id === "string") && job.changes && typeof job.changes === "object" && Array.isArray(job.batches) && job.batches.length > 0 && job.batches.every(batch => typeof batch.operationId === "string" && Array.isArray(batch.bookmarkIds) && batch.bookmarkIds.length <= 500) ? { ...job, state: job.state === "running" ? "paused" : job.state } : null; } catch { return null; }
}
export function writeBatchJob(storage: Pick<Storage, "setItem">, job: OrganizationBatchJob) {
  // Deliberately fail before the first request if recovery cannot be persisted.
  storage.setItem(batchStorageKey(job.accountId), JSON.stringify(job));
}
export async function runBatchJob(job: OrganizationBatchJob, dependencies: {
  apply: (input: OrganizationOperationInput) => Promise<{ operation: OrganizationOperation }>;
  reconcile: (id: string) => Promise<{ operation: OrganizationOperation }>;
  save: (job: OrganizationBatchJob) => void;
  shouldPause: () => boolean;
  onReceipt: (receipt: OrganizationOperation) => void;
}) {
  job.state = "running"; delete job.error; dependencies.save(job);
  for (const batch of job.batches) {
    if (batch.receipt) continue;
    if (dependencies.shouldPause()) { job.state = "paused"; dependencies.save(job); return; }
    // Persist all identities before send; exact unknown retries replay one ID.
    dependencies.save(job);
    try {
      const result = await dependencies.apply({ operationId: batch.operationId, action: "bookmarks.update", bookmarkIds: batch.bookmarkIds, changes: job.changes, ...(job.expected ? { expected: Object.fromEntries(batch.bookmarkIds.filter(id => job.expected?.[id]).map(id => [id, job.expected![id]])) } : {}) });
      batch.receipt = result.operation;
    } catch (error) {
      if (error instanceof Error && "status" in error && Number(error.status) >= 400 && Number(error.status) < 500 && Number(error.status) !== 408 && Number(error.status) !== 429) {
        job.state = "paused"; job.error = `${error.message}. Review the request before resuming.`; dependencies.save(job); return;
      }
      try { batch.receipt = (await dependencies.reconcile(batch.operationId)).operation; }
      catch { job.state = "unknown"; job.error = `${(error as Error).message}. This batch's result is unknown. Resume checks the same operation identity.`; dependencies.save(job); return; }
    }
    dependencies.save(job); dependencies.onReceipt(batch.receipt);
  }
  job.state = "complete"; dependencies.save(job);
}
