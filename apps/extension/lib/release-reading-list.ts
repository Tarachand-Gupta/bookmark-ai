import { browser } from "wxt/browser";
import { detectSource } from "./detect";
import { oauthGeneration } from "./supabase-oauth";
import {
  executeReleaseJob,
  lookupPage,
  releaseSession,
  sessionCurrent,
  type ReleaseSession,
} from "./release-api";
import { releaseFence, releaseJournal } from "./release-background";
import { scopeKey, supportedPage, type ReleasePage } from "./release-state";

const PREFIX = "release1:reading:";
let serial: Promise<unknown> = Promise.resolve();
const queue = <T>(run: () => Promise<T>): Promise<T> => {
  const next = serial.then(run);
  serial = next.catch(() => undefined);
  return next;
};

/** Reading events have their own durable journal, never the native-bookmark
 * delete map. Existing metadata is not supplied to any mutation. */
async function reconcile(key: string, session: ReleaseSession, ownFence: number): Promise<void> {
  const current = () => releaseFence() === ownFence && oauthGeneration() === session.generation;
  if (!current() || !(await sessionCurrent(session))) return;
  let state = await releaseJournal.read(key);
  if (!state?.reading || scopeKey(state.reading.scope) !== scopeKey(session.scope)) return;
  if (state.reading.completed) return;
  if (state.job?.status === "failed") return; // a conflict is definitive, never force it
  if (state.job && ["pending", "unknown"].includes(state.job.status)) {
    await releaseJournal.run(key, current, (job) => executeReleaseJob(session, job));
    state = await releaseJournal.read(key);
    if (state?.job?.status !== "succeeded") return;
  }
  if (!state?.reading) return;
  if (state.job?.request.kind === "edit" && state.job.status === "succeeded") return;
  let bookmark = await lookupPage(session, state.page.url);
  if (!bookmark) {
    // Removal never creates or deletes a bookmark.
    if (state.reading.desired === "not_on_list") {
      await releaseJournal.update(key, current, (latest) => ({
        ...latest!,
        reading: { ...latest!.reading!, completed: true },
      }));
      return;
    }
    await releaseJournal.accept(
      key,
      state.page,
      {
        kind: "save",
        input: {
          url: state.page.url,
          title: state.page.title,
          operationId: state.reading.saveId,
          ...detectSource(),
        },
      },
      current,
    );
    await releaseJournal.run(key, current, (job) => executeReleaseJob(session, job));
    const saved = await releaseJournal.read(key);
    if (saved?.job?.status !== "succeeded") return;
    bookmark = saved.job.result?.bookmark;
  }
  if (!bookmark || !current()) return;
  // Only readingState is patched; titles, folders, categories and ordinary tags
  // (including removed legacy reading/article tags) are untouched.
  await releaseJournal.accept(
    key,
    state.page,
    {
      kind: "edit",
      bookmarkId: bookmark.id,
      input: {
        operationId: state.reading.editId,
        changes: { readingState: state.reading.desired },
        expected: { readingState: bookmark.fieldVersions?.readingState ?? "0" },
      },
    },
    current,
  );
  await releaseJournal.run(key, current, (job) => executeReleaseJob(session, job));
}
export async function mirrorReadingEntry(
  entry: { url: string; title?: string; hasBeenRead?: boolean },
  removed = false,
): Promise<void> {
  if (!supportedPage(entry.url)) return;
  const ownFence = releaseFence();
  const session = await releaseSession();
  if (ownFence !== releaseFence()) return;
  return queue(async () => {
    if (!(await sessionCurrent(session)) || ownFence !== releaseFence()) return;
    const key = `${PREFIX}${JSON.stringify([session.scope.origin, session.scope.accountId, Date.now(), crypto.randomUUID()])}`;
    await releaseJournal.update(
      key,
      () => ownFence === releaseFence() && session.generation === oauthGeneration(),
      () => ({
        page: { url: entry.url, title: (entry.title || entry.url).slice(0, 2000) },
        reading: {
          desired: removed ? "not_on_list" : entry.hasBeenRead ? "read" : "unread",
          saveId: crypto.randomUUID(),
          editId: crypto.randomUUID(),
          scope: session.scope,
          at: Date.now(),
        },
      }),
    );
    await drainScopedEntries(session, ownFence, entry.url);
  });
}
async function drainScopedEntries(
  session: ReleaseSession,
  ownFence: number,
  url?: string,
): Promise<void> {
  const all = await browser.storage.local.get(null);
  const tasks = Object.entries(all)
    .filter(
      ([key, value]) =>
        key.startsWith(PREFIX) &&
        (value as ReleasePage).reading &&
        (!url || (value as ReleasePage).page.url === url) &&
        scopeKey((value as ReleasePage).reading!.scope) === scopeKey(session.scope),
    )
    .sort((a, b) => (a[1] as ReleasePage).reading!.at - (b[1] as ReleasePage).reading!.at);
  const blocked = new Set<string>();
  for (const [key, value] of tasks) {
    if (!(await sessionCurrent(session)) || ownFence !== releaseFence()) return;
    const pageUrl = (value as ReleasePage).page.url;
    if (blocked.has(pageUrl)) continue;
    // An older unresolved event must finish before a newer event can observe
    // versions and mutate the same bookmark. Other pages can still progress.
    try {
      await reconcile(key, session, ownFence);
      const state = await releaseJournal.read(key);
      if (state?.job && ["pending", "unknown"].includes(state.job.status)) blocked.add(pageUrl);
    } catch {
      blocked.add(pageUrl);
    }
  }
}
export async function drainReadingEntries(): Promise<void> {
  const ownFence = releaseFence();
  const session = await releaseSession();
  return queue(() => drainScopedEntries(session, ownFence));
}
