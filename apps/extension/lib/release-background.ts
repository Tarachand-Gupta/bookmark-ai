import { browser } from "wxt/browser";
import {
  composerHandoffSchema,
  createBookmarkSchema,
  organizationOperationSchema,
  updateBookmarkSchema,
  type OrganizationResponse,
} from "@bookmark-ai/types";
import { oauthGeneration } from "./supabase-oauth";
import {
  executeReleaseJob,
  lookupPage,
  readOrganization,
  releaseSession,
  sessionCurrent,
  type ReleaseSession,
} from "./release-api";
import {
  RELEASE_PREFIX,
  ReleaseJournal,
  pageKey,
  scopeKey,
  supportedPage,
  type AskDraft,
  type EditDraft,
  type PageContext,
  type ReleasePage,
  type ReleaseRequest,
  type ReleaseScope,
} from "./release-state";

export const RELEASE_MESSAGE = "RELEASE_1";
export type ReleaseCommand =
  | { action: "load"; page: PageContext }
  | { action: "state" | "check" | "open"; scope: ReleaseScope; page: PageContext }
  | { action: "draft"; scope: ReleaseScope; page: PageContext; field: "edit"; value?: EditDraft }
  | { action: "draft"; scope: ReleaseScope; page: PageContext; field: "ask"; value?: AskDraft }
  | { action: "submit"; scope: ReleaseScope; page: PageContext; request: ReleaseRequest };
export type ReleaseReply = {
  scope: ReleaseScope;
  state: ReleasePage;
  organization?: OrganizationResponse;
  organizationError?: string;
};
let fence = 0;
export const releaseFence = () => fence;
const leases = new Map<string, { session: ReleaseSession; fence: number }>();
export const releaseJournal = new ReleaseJournal({
  read: async (key) => (await browser.storage.local.get(key))[key] as ReleasePage | undefined,
  write: async (key, value) => {
    await browser.storage.local.set({ [key]: value });
  },
});

/** Called on explicit sign-out only; expiry keeps drafts without granting access.
 * Raise the fence before waiting for writes, so late completions cannot recreate data. */
export async function clearReleasePrivateState(): Promise<void> {
  fence++;
  leases.clear();
  await releaseJournal.settleWrites();
  const keys = Object.keys(await browser.storage.local.get(null)).filter((key) =>
    key.startsWith(RELEASE_PREFIX),
  );
  if (keys.length) await browser.storage.local.remove(keys);
}
async function recentDestinations(scope: ReleaseScope): Promise<string[]> {
  const all = await browser.storage.local.get(null);
  const entries = Object.entries(all).flatMap(([key, value]) => {
    if (!key.startsWith(RELEASE_PREFIX + "[")) return [];
    try {
      const [origin, accountId] = JSON.parse(key.slice(RELEASE_PREFIX.length));
      if (origin !== scope.origin || accountId !== scope.accountId) return [];
      const job = (value as ReleasePage).job;
      if (
        job?.status !== "succeeded" ||
        job.request.kind !== "edit" ||
        !job.request.input.changes.folderId
      )
        return [];
      return [
        {
          id: job.request.input.changes.folderId,
          at: Date.parse(job.result?.operation?.createdAt ?? "") || 0,
        },
      ];
    } catch {
      return [];
    }
  });
  return [...new Set(entries.sort((a, b) => b.at - a.at).map((entry) => entry.id))].slice(0, 5);
}
function validRequest(request: ReleaseRequest): ReleaseRequest {
  switch (request.kind) {
    case "save":
      return {
        kind: "save",
        input: createBookmarkSchema.parse(request.input) as typeof request.input,
      };
    case "edit":
      if (!request.bookmarkId || request.bookmarkId.length > 200)
        throw new Error("Invalid bookmark");
      return {
        kind: "edit",
        bookmarkId: request.bookmarkId,
        input: updateBookmarkSchema.parse(request.input),
      };
    case "create": {
      const input = organizationOperationSchema.parse(request.input);
      if (!["folder.create", "category.create", "tag.create"].includes(input.action))
        throw new Error("Use the app to manage organization.");
      return { kind: "create", input };
    }
    case "handoff":
      return { kind: "handoff", input: composerHandoffSchema.parse(request.input) };
    default:
      throw new Error("Invalid request");
  }
}
export async function handleReleaseCommand(command: ReleaseCommand): Promise<ReleaseReply> {
  if (!supportedPage(command.page.url) || command.page.title.length > 2000)
    throw new Error("This page cannot be saved or used as AI context.");
  const ownFence = fence;
  let session: ReleaseSession;
  // Draft writes must not require a working network. Only a previously verified,
  // generation-bound lease can write; a restarted worker needs a fresh /me proof.
  if (command.action === "draft" || command.action === "state") {
    const lease = leases.get(scopeKey(command.scope));
    if (!lease || lease.fence !== fence || !(await sessionCurrent(lease.session)))
      throw new Error("Sign in again to resume this account's draft.");
    session = lease.session;
  } else {
    session = await releaseSession(command.action === "load" ? undefined : command.scope);
    if (fence !== ownFence) throw new Error("Account changed. Reopen the popup.");
    leases.clear();
    leases.set(scopeKey(session.scope), { session, fence });
  }
  const current = () =>
    fence === ownFence &&
    oauthGeneration() === session.generation &&
    leases.get(scopeKey(session.scope))?.session.scope.accountId === session.scope.accountId;
  const key = pageKey(session.scope, command.page.url);
  const reply = async (extra = {}): Promise<ReleaseReply> => {
    if (!(await sessionCurrent(session)) || !current())
      throw new Error("Account changed. Reopen the popup.");
    const state = (await releaseJournal.read(key)) ?? { page: command.page };
    if (state.job?.status === "pending" && !releaseJournal.isRunning(key))
      state.job = {
        ...state.job,
        status: "unknown",
        error: "Background completion was interrupted. Check the saved request.",
      };
    return { scope: session.scope, state, ...extra };
  };
  if (command.action === "draft") {
    if (command.field === "ask" && command.value) {
      composerHandoffSchema.parse({ operationId: "draft-validation", draft: command.value });
      if (command.value.context.type !== "page" || command.value.context.url !== command.page.url)
        throw new Error("Page context changed");
    }
    await releaseJournal.update(key, current, (state) => {
      if (state?.job && ["pending", "unknown"].includes(state.job.status))
        throw new Error("Check the accepted request before changing its draft.");
      const next = { ...state, page: state?.page ?? command.page, [command.field]: command.value };
      if (command.field === "ask" && !command.value) {
        delete next.transfer;
        if (next.job?.request.kind === "handoff") delete next.job;
      }
      return next;
    });
    return reply();
  }
  if (command.action === "load") {
    const [bookmarkResult, organizationResult] = await Promise.allSettled([
      lookupPage(session, command.page.url),
      readOrganization(session),
    ]);
    if (!current()) throw new Error("Account changed. Reopen the popup.");
    if (bookmarkResult.status === "fulfilled" && bookmarkResult.value)
      await releaseJournal.update(key, current, (state) => ({
        ...state,
        page: state?.page ?? command.page,
        bookmark: bookmarkResult.value,
        existing: state?.existing ?? true,
      }));
    const recent = await recentDestinations(session.scope);
    if (recent.length)
      await releaseJournal.update(key, current, (state) => ({
        ...state,
        page: state?.page ?? command.page,
        recentFolders: recent,
      }));
    // Only already accepted work resumes. Unsent drafts never dispatch themselves.
    void releaseJournal.run(key, current, (job) => executeReleaseJob(session, job));
    return reply(
      organizationResult.status === "fulfilled"
        ? { organization: organizationResult.value }
        : {
            organizationError:
              "Quick organization is unavailable on this server. Your saved link and drafts are kept.",
          },
    );
  }
  if (command.action === "submit") {
    const request = validRequest(command.request);
    if (!request.input.operationId) throw new Error("A stable request identity is required");
    if (request.kind === "save" && request.input.url !== command.page.url)
      throw new Error("Page changed");
    if (
      request.kind === "handoff" &&
      (request.input.draft.context.type !== "page" ||
        request.input.draft.context.url !== command.page.url)
    )
      throw new Error("Page context changed");
    await releaseJournal.accept(key, command.page, request, current);
    void releaseJournal.run(key, current, (job) => executeReleaseJob(session, job));
    return reply();
  }
  if (command.action === "check") {
    void releaseJournal.run(key, current, (job) => executeReleaseJob(session, job));
    return reply();
  }
  if (command.action === "open") {
    const state = await releaseJournal.read(key);
    const handoff = state?.transfer?.handoff;
    if (!handoff) throw new Error("Save the handoff before opening the app.");
    if (!current() || !(await sessionCurrent(session)))
      throw new Error("Account changed. Reopen the popup.");
    // Claim is idempotent. Reopening uses the same opaque ID, even after a lost
    // tabs.create acknowledgement. Only explicit Recreate produces another ID.
    const tab = await browser.tabs.create({
      url: `${session.scope.origin}/app/library?handoff=${encodeURIComponent(handoff.id)}`,
    });
    if (typeof tab?.id !== "number")
      throw new Error("The app tab did not open. Your draft is kept; retry opening.");
    await releaseJournal.update(key, current, (latest) => ({
      ...latest!,
      transfer: { ...latest!.transfer!, opened: true },
    }));
    return reply();
  }
  return reply();
}
