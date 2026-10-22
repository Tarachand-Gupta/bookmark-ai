import type { BulkBookmarkChanges, OrganizationResponse } from "@bookmark-ai/types";
import { batchStorageKey, readBatchJob, runBatchJob, writeBatchJob, type OrganizationBatchJob } from "./organization-batches";

type BatchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readPendingBulkJob(storage: Pick<Storage, "getItem">, accountId: string) {
  const raw = storage.getItem(batchStorageKey(accountId));
  const job = readBatchJob(storage, accountId);
  if (raw !== null && !job) throw new Error("A saved change could not be read. It has been kept; a new change cannot replace it.");
  return job;
}
export function reserveBulkJob(storage: BatchStorage, job: OrganizationBatchJob) {
  if (storage.getItem(batchStorageKey(job.accountId)) !== null) throw new Error("Resolve the saved change before applying this new edit.");
  writeBatchJob(storage, job);
}
export function saveOwnedBulkJob(storage: BatchStorage, job: OrganizationBatchJob) {
  if (readPendingBulkJob(storage, job.accountId)?.id !== job.id) throw new Error("The saved change has changed. Close and reopen to review it.");
  writeBatchJob(storage, job);
}
export function clearCompletedBulkJob(storage: BatchStorage, job: OrganizationBatchJob) {
  if (job.state !== "complete" || job.batches.some(batch => !batch.receipt)) return;
  if (readPendingBulkJob(storage, job.accountId)?.id === job.id) storage.removeItem(batchStorageKey(job.accountId));
}
export function bulkDestination(action: "category", destination: string | null | undefined, data: Pick<OrganizationResponse, "categories">) {
  if (destination === undefined) return { valid: false, label: "Choose a category" };
  if (destination === null) return { valid: true, label: "No category" };
  const label = data.categories.find(category => category.id === destination)?.name;
  return { valid: !!label, label: label ?? "Category no longer available" };
}
export function bulkChangeDescription(changes: BulkBookmarkChanges, data: Pick<OrganizationResponse, "categories">) {
  if ("categoryId" in changes) return `Set category to ${bulkDestination("category", changes.categoryId, data).label}`;
  return changes.addTags ? `Add tags: ${changes.addTags.join(", ")}` : `Remove tags: ${changes.removeTags?.join(", ")}`;
}

// A reload cannot tell which request was in flight. Look up every unresolved
// identity before sending anything, and replay only its exact frozen payload.
export async function recoverBulkJob(job: OrganizationBatchJob, destinationAvailable: boolean, dependencies: Parameters<typeof runBatchJob>[1]) {
  for (const batch of job.batches) {
    if (batch.receipt) continue;
    if (dependencies.shouldPause()) { job.state = "paused"; dependencies.save(job); return; }
    try {
      batch.receipt = (await dependencies.reconcile(batch.operationId)).operation;
    } catch (error) {
      if (!(error instanceof Error && "status" in error && error.status === 404)) {
        job.state = "unknown"; job.error = "Could not confirm the original change. Its IDs and destination are still saved.";
        dependencies.save(job); return;
      }
      continue;
    }
    dependencies.save(job); dependencies.onReceipt(batch.receipt);
  }
  if (!destinationAvailable && job.batches.some(batch => !batch.receipt)) {
    job.state = "paused"; job.error = "The original destination is no longer available. Unconfirmed groups remain saved with their original IDs and payload; they cannot be replaced by a new edit.";
    dependencies.save(job); return;
  }
  await runBatchJob(job, dependencies);
}
