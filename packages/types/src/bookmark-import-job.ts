import { z } from "zod";
import { browserSchema, deviceTypeSchema } from "./bookmark";
import {
  BOOKMARK_IMPORT_BATCH_SIZE,
  BOOKMARK_IMPORT_MAX_ITEMS,
  bookmarkImportApplyRequestSchema,
  bookmarkImportItemSchema,
  type BookmarkImportApplyRequest,
  type BookmarkImportPreview,
  type BookmarkImportResult,
} from "./bookmark-import";

const outcomeSchema = z.object({
  key: z.string(),
  url: z.string(),
  status: z.enum(["imported", "existing", "failed"]),
  bookmarkId: z.string().optional(),
  error: z.string().optional(),
});
export const bookmarkImportJobSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  accountId: z.string().min(1),
  origin: z.string().min(1),
  createdAt: z.string(),
  items: z.array(bookmarkImportItemSchema).max(BOOKMARK_IMPORT_MAX_ITEMS),
  outcomes: z.array(outcomeSchema).max(BOOKMARK_IMPORT_MAX_ITEMS),
  browser: browserSchema,
  device: deviceTypeSchema,
  preserveFolders: z.boolean(),
  pending: bookmarkImportApplyRequestSchema.nullable(),
  status: z.enum(["reviewed", "running", "paused", "completed"]),
  error: z.string().nullable(),
  duplicateCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
});
export type BookmarkImportJob = z.infer<typeof bookmarkImportJobSchema>;

export function bookmarkImportStorageKey(accountId: string, origin: string): string {
  return `bmk:import:v1:${encodeURIComponent(origin)}:${encodeURIComponent(accountId)}`;
}

export function restoreBookmarkImportJob(
  raw: string | null,
  accountId: string,
  origin: string,
): BookmarkImportJob | null {
  if (!raw || raw.length > 12 * 1024 * 1024) return null;
  try {
    const parsed = bookmarkImportJobSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.accountId !== accountId || parsed.data.origin !== origin)
      return null;
    const job = parsed.data;
    if (new Set(job.items.map((item) => item.key)).size !== job.items.length) return null;
    const items = new Map(job.items.map((item) => [item.key, item]));
    if (
      new Set(job.outcomes.map((item) => item.key)).size !== job.outcomes.length ||
      job.outcomes.some((item) => items.get(item.key)?.url !== item.url)
    )
      return null;
    if (
      job.pending &&
      (new Set(job.pending.items.map((item) => item.key)).size !== job.pending.items.length ||
        job.pending.preserveFolders !== job.preserveFolders ||
        job.pending.browser !== job.browser ||
        job.pending.device !== job.device)
    )
      return null;
    if (
      job.pending &&
      job.pending.items.some(
        (item) =>
          !job.items.some((candidate) => candidate.key === item.key && candidate.url === item.url),
      )
    )
      return null;
    return { ...job, status: job.status === "running" ? "paused" : job.status };
  } catch {
    return null;
  }
}

export function createBookmarkImportJob(
  preview: BookmarkImportPreview,
  options: Pick<
    BookmarkImportJob,
    "id" | "accountId" | "origin" | "browser" | "device" | "preserveFolders"
  >,
): BookmarkImportJob {
  return {
    ...options,
    version: 1,
    createdAt: new Date().toISOString(),
    items: preview.items.map(({ status: _status, ...item }) => item),
    outcomes: preview.items
      .filter((item) => item.status === "existing")
      .map((item) => ({ key: item.key, url: item.url, status: "existing" })),
    pending: null,
    status: "reviewed",
    error: null,
    duplicateCount: preview.duplicateCount,
    invalidCount: preview.invalidCount,
  };
}

export function bookmarkImportProgress(job: BookmarkImportJob) {
  const counts = {
    imported: 0,
    existing: 0,
    failed: 0,
    remaining: job.items.length - job.outcomes.length,
    total: job.items.length,
  };
  for (const item of job.outcomes) counts[item.status]++;
  return counts;
}

/** A new request ID is used only for rows the server definitively marked failed. */
export function retryFailedBookmarkImports(job: BookmarkImportJob): BookmarkImportJob {
  if (job.pending) return job;
  return {
    ...job,
    outcomes: job.outcomes.filter((item) => item.status !== "failed"),
    status: "paused",
    error: null,
  };
}

export interface BookmarkImportRunner {
  apply: (request: BookmarkImportApplyRequest) => Promise<BookmarkImportResult>;
  /** Must persist before resolving. Throwing pauses before the first request. */
  save: (job: BookmarkImportJob) => Promise<void>;
  uuid: () => string;
  isCurrentAccount: () => boolean;
  shouldPause: () => boolean;
  changed: (job: BookmarkImportJob) => void;
}

/** Shared client runner. Close pauses after the accepted batch; popup lifetime never owns it. */
export async function runBookmarkImportJob(
  initial: BookmarkImportJob,
  runner: BookmarkImportRunner,
): Promise<BookmarkImportJob> {
  let job = initial;
  const publish = async (next: BookmarkImportJob) => {
    if (!runner.isCurrentAccount()) return false;
    await runner.save(next);
    if (!runner.isCurrentAccount()) return false;
    job = next;
    runner.changed(job);
    return true;
  };
  try {
    while (runner.isCurrentAccount()) {
      const known = new Set(job.outcomes.map((item) => item.key));
      const remaining = job.items.filter((item) => !known.has(item.key));
      if (!job.pending && remaining.length === 0) {
        await publish({ ...job, status: "completed", error: null });
        return job;
      }
      if (runner.shouldPause()) {
        await publish({ ...job, status: "paused" });
        return job;
      }
      const pending = job.pending ?? {
        action: "apply" as const,
        requestId: runner.uuid(),
        items: remaining.slice(0, BOOKMARK_IMPORT_BATCH_SIZE),
        browser: job.browser,
        device: job.device,
        preserveFolders: job.preserveFolders,
      };
      if (!(await publish({ ...job, status: "running", error: null, pending }))) return job;
      const result = await runner.apply(pending);
      if (!runner.isCurrentAccount()) return job;
      const keys = new Set(pending.items.map((item) => item.key));
      if (
        result.requestId !== pending.requestId ||
        result.items.length !== keys.size ||
        new Set(result.items.map((item) => item.key)).size !== keys.size ||
        result.items.some(
          (item) =>
            !pending.items.some(
              (candidate) => candidate.key === item.key && candidate.url === item.url,
            ),
        ) ||
        result.items.some((item) => !["imported", "existing", "failed"].includes(item.status))
      ) {
        throw new Error(
          "The server returned an incomplete receipt. Retry to reconcile the same batch.",
        );
      }
      if (
        !(await publish({
          ...job,
          outcomes: [...job.outcomes.filter((item) => !keys.has(item.key)), ...result.items],
          pending: null,
        }))
      )
        return job;
    }
  } catch (error) {
    const paused = {
      ...job,
      status: "paused" as const,
      error:
        error instanceof Error
          ? error.message
          : "Import paused. Try again when the connection is available.",
    };
    if (runner.isCurrentAccount()) {
      job = paused;
      // Keep the last durable pending UUID even when storage itself fails.
      try {
        await runner.save(paused);
      } catch {
        /* Never start another batch without durable state. */
      }
      runner.changed(paused);
    }
  }
  return job;
}
