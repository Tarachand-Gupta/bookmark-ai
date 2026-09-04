import { storage } from "#imports";
import { browser } from "wxt/browser";
import { createBookmark, deleteBookmark, fetchSyncSettings } from "@/lib/api";
import { detectSource } from "@/lib/detect";
import { diag } from "@/lib/diag";
import { isBackfilledNode } from "@/lib/native-sync-import";
import { drainMirrorQueue, enqueueMirrorAdd } from "@/lib/native-sync-queue";

/**
 * NATIVE BROWSER SYNC — mirror native bookmark additions (and Chrome's Reading
 * List) into the library. Chrome + Firefox only: Safari exposes NEITHER the
 * bookmarks namespace nor any Reading List API (MDN compat: bookmarks
 * version_added false for Safari), so this whole module is a compile-time no-op
 * in the Safari bundle and its manifest never declares those permissions.
 *
 * Default-additive: removing a native bookmark does NOT remove the saved copy
 * unless the user turns on "full sync" in the web app's Settings → Sync. Both
 * toggles live server-side (user_settings) and are pulled down by
 * `refreshNativeSyncSettings` (boot + the 6h auth alarm) into the cached copies
 * below, which the listeners re-read on EVERY wake — worker globals are
 * untrustworthy (the same privacy argument as live-storage.ts, §4.5).
 *
 * Known shape limits (can't be worked around in the extension APIs):
 *  - Bookmark imports (both browsers fire onCreated for EVERY imported node) are
 *    ignored so an import doesn't hammer the saves quota — on Chrome via the
 *    onImportBegan/onImportEnded bracket, and on EVERY browser via the node's
 *    `dateAdded` (lib/native-sync-import.ts): Firefox has no import events at
 *    all, and importers/restores/Sync preserve the original creation time, so a
 *    node older than a minute when we hear about it is backfill, not a live add.
 *  - Removing a whole folder fires ONE onRemoved for the folder; children
 *    don't report, so their mirrors stay. Documented in the settings copy.
 */

/** Build-target browser (Vite inlines this; dead-code-eliminates the
 * readingList block from non-Chrome bundles). */
const BROWSER = import.meta.env.BROWSER;

/** Master sync switch — cached copy of the account-level server setting.
 * Default ON (product decision: additive mirroring just happens); the server
 * value overwrites this on the next refreshNativeSyncSettings. */
export const nativeSyncEnabledItem = storage.defineItem<boolean>("local:nativeSyncEnabled", {
  fallback: true,
});

/** Full sync (removals propagate) — default OFF. Removing a native bookmark
 * keeps the saved copy unless this is on. */
export const nativeSyncFullItem = storage.defineItem<boolean>("local:nativeSyncFull", {
  fallback: false,
});

/** Reading-list entries get these tags so they're searchable later. */
const READING_TAGS = ["reading", "article"];

/** url → bookmark id for additions mirrored BY THIS INSTALL. Lets the removal
 * mirror delete by id directly (device tokens can't list the library, so a
 * local map beats a server-side lookup). Capped FIFO to keep storage.local
 * small; a missing overflowed entry just leaves the saved copy (additive
 * default, harmless). */
const nativeUrlIdItem = storage.defineItem<Record<string, string>>("local:nativeSyncIds", {
  fallback: {},
});
const URL_ID_MAP_CAP = 2000;

async function readUrlIdMap(): Promise<Record<string, string>> {
  return nativeUrlIdItem.getValue().catch((): Record<string, string> => ({}));
}

async function rememberUrlId(url: string, id: string): Promise<void> {
  const map = await readUrlIdMap();
  map[url] = id;
  const keys = Object.keys(map);
  if (keys.length > URL_ID_MAP_CAP) {
    for (const k of keys.slice(0, keys.length - URL_ID_MAP_CAP)) delete map[k];
  }
  await nativeUrlIdItem.setValue(map).catch(() => {});
}

async function takeUrlId(url: string): Promise<string | undefined> {
  const map = await readUrlIdMap();
  const id = map[url];
  if (id) {
    delete map[url];
    await nativeUrlIdItem.setValue(map).catch(() => {});
  }
  return id;
}

/** In-memory "a bookmark import session is running" flag (Chrome's
 * onImportBegan/onImportEnded bracket the flood of onCreated events an import
 * produces — Chrome's docs tell observers to ignore onCreated between them,
 * and the flood would hammer the API + the saves quota). */
let importing = false;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isHttp = (url: string | undefined): url is string => !!url && /^https?:/i.test(url);

/** POST the mirror and remember the url→id mapping. Throws on failure — the two
 * callers (the live listener and the retry drain) handle that differently. */
async function sendMirrorAdd(
  url: string,
  title: string | undefined,
  tags?: string[],
): Promise<void> {
  const bookmark = await createBookmark({
    url,
    title: title || undefined,
    tags,
    ...detectSource(),
  });
  await rememberUrlId(url, bookmark.id);
  diag("nativeSync", "added", { domain: bookmark.domain, tagged: !!tags });
}

/** Mirror a native addition (bookmark, or reading-list entry with tags). A
 * failure is QUEUED rather than dropped: `authFetch` has already spent its
 * one-shot 401 retry by the time we get here, so anything still failing needs a
 * later attempt (boot / the 6h alarm) — the browser will never re-fire the
 * onCreated event that produced this call. */
async function mirrorAdd(url: string | undefined, title: string | undefined, tags?: string[]) {
  if (importing || !isHttp(url)) return;
  const enabled = await nativeSyncEnabledItem.getValue().catch(() => true);
  if (!enabled) {
    diag("nativeSync", "add skipped (sync off)");
    return;
  }
  try {
    await sendMirrorAdd(url, title, tags);
  } catch (e) {
    diag("nativeSync", "add failed (queued)", { error: errMsg(e) });
    await enqueueMirrorAdd({ url, title, tags });
  }
}

/** Retry every mirror add that failed earlier. Called at background boot and on
 * the 6h auth alarm, i.e. after the auth ladder has had its chance to replace a
 * bad credential. While the master toggle is OFF the queue is left untouched
 * rather than flushed — turning sync back on should not silently discard the
 * pending adds, and mirroring them while it's off would be wrong. */
export async function drainNativeSyncQueue(): Promise<void> {
  if (BROWSER === "safari") return; // the module no-ops there anyway
  const enabled = await nativeSyncEnabledItem.getValue().catch(() => true);
  if (!enabled) return;
  await drainMirrorQueue(async (entry) => {
    try {
      await sendMirrorAdd(entry.url, entry.title, entry.tags);
      return true;
    } catch {
      return false;
    }
  });
}

/** Mirror a native removal — only under full-sync. Folder removals report only
 * the folder node (children fire no events), so their mirrors always stay. */
async function mirrorRemove(url: string | undefined) {
  if (!isHttp(url)) return;
  const full = await nativeSyncFullItem.getValue().catch(() => false);
  if (!full) return;
  const id = await takeUrlId(url);
  if (!id) return; // was never mirrored by this install — nothing to propagate
  try {
    await deleteBookmark(id);
    diag("nativeSync", "removed (full sync)");
  } catch (e) {
    diag("nativeSync", "remove failed", { error: errMsg(e) });
  }
}

/** Pull the account-level sync toggles down into the cached storage items.
 * Called at boot and on the 6h auth alarm; a failure keeps the cached flags. */
export async function refreshNativeSyncSettings(): Promise<void> {
  if (BROWSER === "safari") return; // the module no-ops there anyway
  const settings = await fetchSyncSettings();
  if (!settings) return;
  if (typeof settings.nativeSyncEnabled === "boolean") {
    await nativeSyncEnabledItem.setValue(settings.nativeSyncEnabled).catch(() => {});
  }
  if (typeof settings.nativeSyncFull === "boolean") {
    await nativeSyncFullItem.setValue(settings.nativeSyncFull).catch(() => {});
  }
  diag("nativeSync", "settings refreshed", {
    enabled: settings.nativeSyncEnabled ?? null,
    full: settings.nativeSyncFull ?? null,
  });
}

/** Chrome-only Reading List API (`browser`/webextension-polyfill don't expose
 * or type it) — present since Chrome 120; undefined on older versions and in
 * every non-Chrome build, and the listener additions feature-detect it. */
interface ReadingListEntry {
  title: string;
  url: string;
  hasBeenRead: boolean;
}
interface ReadingListApi {
  onEntryAdded: { addListener: (cb: (entry: ReadingListEntry) => void) => void };
  onEntryRemoved: { addListener: (cb: (entry: ReadingListEntry) => void) => void };
}
function chromeReadingList(): ReadingListApi | undefined {
  if (BROWSER !== "chrome") return undefined;
  return (globalThis as unknown as { chrome?: { readingList?: ReadingListApi } }).chrome
    ?.readingList;
}

/**
 * Register every native-sync listener synchronously (the MV3 worker only wakes
 * for listeners registered at script evaluation). Call from defineBackground
 * inside its try/catch wrapper. A no-op under Safari.
 */
export function registerNativeSync(): void {
  if (BROWSER === "safari") return;

  browser.bookmarks.onCreated.addListener((_id, node) => {
    // Backfill gate (imports/restores/Sync): the cross-browser twin of the
    // onImportBegan/onImportEnded bracket below — Firefox never implemented
    // those events, so without this an import mirrored every node.
    if (isBackfilledNode(node.dateAdded)) {
      diag("nativeSync", "add skipped (backfilled node)", {
        ageMs: Date.now() - (node.dateAdded ?? Date.now()),
      });
      return;
    }
    void mirrorAdd(node.url, node.title);
  });
  browser.bookmarks.onRemoved.addListener((_id, info) => {
    void mirrorRemove(info.node?.url);
  });
  // Import-flood suppression. Firefox's onImportBegan/onImportEnded sit outside
  // the polyfill's types on some versions — guard the whole pair.
  const bookmarksApi = browser.bookmarks as unknown as {
    onImportBegan?: { addListener: (cb: () => void) => void };
    onImportEnded?: { addListener: (cb: () => void) => void };
  };
  bookmarksApi.onImportBegan?.addListener(() => {
    importing = true;
  });
  bookmarksApi.onImportEnded?.addListener(() => {
    importing = false;
  });

  const readingList = chromeReadingList();
  if (readingList) {
    readingList.onEntryAdded.addListener((entry) => {
      void mirrorAdd(entry.url, entry.title, READING_TAGS);
    });
    readingList.onEntryRemoved.addListener((entry) => {
      void mirrorRemove(entry.url);
    });
    diag("nativeSync", "reading list listener registered");
  }
  diag("nativeSync", "registered", { browser: BROWSER });
}
