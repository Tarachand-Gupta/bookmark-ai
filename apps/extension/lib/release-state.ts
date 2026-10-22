import type {
  Bookmark,
  BookmarkChanges,
  ComposerHandoff,
  ComposerHandoffInput,
  CreateBookmarkInput,
  OrganizationOperation,
  OrganizationOperationInput,
  UpdateBookmarkInput,
} from "@bookmark-ai/types";

export type ReleaseScope = { accountId: string; origin: string };
export type PageContext = { url: string; title: string };
export type EditValues = {
  title: string;
  folderId: string | null;
  categoryId: string | null;
  tags: string[];
  readingState: "not_on_list" | "unread" | "read";
};
export type EditDraft = {
  base: Bookmark;
  values: EditValues;
  creating?: { kind: "folder" | "category" | "tag"; name: string; parentId: string | null };
};
export type AskDraft = ComposerHandoffInput["draft"];
export type ReleaseRequest =
  | { kind: "save"; input: CreateBookmarkInput & { operationId: string } }
  | { kind: "edit"; bookmarkId: string; input: UpdateBookmarkInput }
  | { kind: "create"; input: OrganizationOperationInput }
  | { kind: "handoff"; input: ComposerHandoffInput };
export type ReleaseResult = {
  bookmark?: Bookmark;
  existing?: boolean;
  operation?: OrganizationOperation;
  handoff?: ComposerHandoff;
};
export type ReleaseJob = {
  request: ReleaseRequest;
  status: "pending" | "unknown" | "succeeded" | "failed";
  result?: ReleaseResult;
  error?: string;
  opened?: boolean;
};
export type ReleasePage = {
  transfer?: { input: ComposerHandoffInput; handoff: ComposerHandoff; opened?: boolean };
  reading?: {
    desired: "not_on_list" | "unread" | "read";
    saveId: string;
    editId: string;
    scope: ReleaseScope;
    at: number;
    completed?: boolean;
  };
  page: PageContext;
  edit?: EditDraft;
  ask?: AskDraft;
  bookmark?: Bookmark;
  existing?: boolean;
  job?: ReleaseJob;
  recentFolders?: string[];
};
export const RELEASE_PREFIX = "release1:";
export function scopeKey(scope: ReleaseScope): string {
  return JSON.stringify([scope.origin, scope.accountId]);
}
export function pageKey(scope: ReleaseScope, url: string): string {
  return RELEASE_PREFIX + JSON.stringify([scope.origin, scope.accountId, url]);
}
export function editValues(bookmark: Bookmark): EditValues {
  return {
    title: bookmark.title,
    folderId: bookmark.folderId ?? null,
    categoryId: bookmark.categoryId ?? null,
    tags: [...bookmark.tags],
    readingState: bookmark.readingState ?? "not_on_list",
  };
}
export function editChanges(draft: EditDraft): BookmarkChanges {
  const before = editValues(draft.base);
  return Object.fromEntries(
    Object.entries(draft.values).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof EditValues]),
    ),
  ) as BookmarkChanges;
}
/** Explicit conflict resolution carries only the user's original changed fields
 * onto the latest base, preserving newer unrelated changes. */
export function rebaseEdit(draft: EditDraft, current: Bookmark): EditDraft {
  return { ...draft, base: current, values: { ...editValues(current), ...editChanges(draft) } };
}
export function supportedPage(url: string): boolean {
  try {
    const value = new URL(url);
    return ["http:", "https:"].includes(value.protocol) && !value.username && !value.password;
  } catch {
    return false;
  }
}

/** One writer in the background. Failed durable admission prevents all network mutation.
 * Receipts and drafts are independent: completing an old edit cannot clear a newer draft. */
export class ReleaseJournal {
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Map<string, Promise<void>>();
  constructor(
    private io: {
      read(key: string): Promise<ReleasePage | undefined>;
      write(key: string, value: ReleasePage): Promise<void>;
    },
  ) {}
  async read(key: string): Promise<ReleasePage | undefined> {
    await this.writes;
    return this.io.read(key);
  }
  update(
    key: string,
    current: () => boolean,
    update: (page: ReleasePage | undefined) => ReleasePage,
  ): Promise<ReleasePage> {
    const task = this.writes.then(async () => {
      if (!current()) throw new Error("Account changed. Reopen the popup.");
      const before = await this.io.read(key);
      if (!current()) throw new Error("Account changed. Reopen the popup.");
      const next = update(before);
      await this.io.write(key, next);
      if (!current()) throw new Error("Account changed. Reopen the popup.");
      return next;
    });
    this.writes = task.catch(() => undefined);
    return task;
  }
  isRunning(key: string): boolean {
    return this.active.has(key);
  }
  async settleWrites(): Promise<void> {
    await this.writes;
  }
  async accept(
    key: string,
    page: PageContext,
    request: ReleaseRequest,
    current: () => boolean,
  ): Promise<ReleasePage> {
    return this.update(key, current, (state) => {
      if (state?.job && ["pending", "unknown"].includes(state.job.status)) {
        if (JSON.stringify(state.job.request) !== JSON.stringify(request))
          throw new Error("Check the previous request's result before starting another.");
        return state;
      }
      return { ...state, page, job: { request: structuredClone(request), status: "pending" } };
    });
  }
  run(
    key: string,
    current: () => boolean,
    execute: (job: ReleaseJob) => Promise<ReleaseResult>,
  ): Promise<void> {
    const running = this.active.get(key);
    if (running) return running;
    const task = (async () => {
      const state = await this.read(key);
      const job = state?.job;
      if (!job || !["pending", "unknown"].includes(job.status) || !current()) return;
      try {
        await this.update(key, current, (latest) => ({
          ...latest!,
          job: { ...job, status: "pending" },
        }));
        const result = await execute(job);
        if (!current()) return;
        await this.update(key, current, (latest) => {
          if (!latest || latest.job?.request.input.operationId !== job.request.input.operationId)
            throw new Error("Request superseded");
          const failed = !!result.operation?.failedCount;
          const next: ReleasePage = {
            ...latest,
            job: {
              ...job,
              result,
              status: failed ? "failed" : "succeeded",
              error: failed
                ? (result.operation?.results.find((r) => r.error)?.error?.message ??
                  "Changes were not applied.")
                : undefined,
            },
          };
          if (!failed && job.request.kind === "handoff" && result.handoff)
            next.transfer = { input: job.request.input, handoff: result.handoff };
          if (result.bookmark) {
            next.bookmark = result.bookmark;
            next.existing = result.existing ?? latest.existing;
          }
          if (
            !failed &&
            job.request.kind === "edit" &&
            latest.edit &&
            JSON.stringify(editChanges(latest.edit)) === JSON.stringify(job.request.input.changes)
          ) {
            delete next.edit;
            const folder = result.bookmark?.folderId;
            if (folder)
              next.recentFolders = [
                folder,
                ...(latest.recentFolders ?? []).filter((id) => id !== folder),
              ].slice(0, 5);
          }
          return next;
        });
      } catch (error) {
        if (!current()) return;
        // A receipt write failure is also unknown: retain the original admitted operation.
        await this.update(key, current, (latest) => ({
          ...latest!,
          job: {
            ...job,
            status: error instanceof DefinitiveReleaseError ? "failed" : "unknown",
            error:
              error instanceof Error
                ? error.message
                : "Outcome unknown. Check result before retrying.",
          },
        })).catch(() => undefined);
      }
    })().finally(() => this.active.delete(key));
    this.active.set(key, task);
    return task;
  }
}
export class DefinitiveReleaseError extends Error {}
