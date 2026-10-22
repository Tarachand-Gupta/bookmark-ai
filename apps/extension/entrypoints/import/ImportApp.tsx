import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  bookmarkImportProgress,
  bookmarkImportStorageKey,
  createBookmarkImportJob,
  restoreBookmarkImportJob,
  retryFailedBookmarkImports,
  runBookmarkImportJob,
  type BookmarkImportJob,
  type BookmarkImportPreview,
} from "@bookmark-ai/types";
import {
  applyExtensionImportBatch,
  extensionImportRequest,
  getImportAccount,
  readBrowserImportPreview,
  importAccountSubject,
  readExtensionImportSyncSettings,
} from "../../lib/bookmark-import";
import { getWebBaseUrl } from "../../lib/api";
import { SUPABASE_AUTH } from "../../lib/supabase-oauth";
import {
  initializeBookmarkConsent,
  hasBookmarkPermission,
  setBookmarkAdditionsConsent,
  bookmarkMirroringAllowed,
  type NativeBookmarkConsent,
} from "../../lib/native-bookmark-consent";

const button =
  "rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";

export function ImportApp() {
  const [identity, setIdentity] = useState<{ accountId: string; origin: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [permission, setPermission] = useState(false);
  const [consent, setConsent] = useState<NativeBookmarkConsent | null>(null);
  const [syncSettings, setSyncSettings] = useState<{
    nativeSyncEnabled?: boolean;
    nativeSyncFull?: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<BookmarkImportPreview | null>(null);
  const [job, setJob] = useState<BookmarkImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);
  const account = useRef<string | null>(null);
  const pause = useRef(false);
  const active = useRef(false);
  const safari = import.meta.env.BROWSER === "safari";

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const next = await getImportAccount();
        if (cancelled || request !== generation) return;
        if (account.current !== next?.accountId) {
          pause.current = true;
          setPreview(null);
          setJob(null);
        }
        account.current = next?.accountId ?? null;
        if (next) {
          await extensionImportRequest(next.accountId);
          if (cancelled || request !== generation) return;
          setIdentity(next);
          const settings = await readExtensionImportSyncSettings(next.accountId);
          if (cancelled || request !== generation) return;
          setSyncSettings(settings ?? null);
          const key = bookmarkImportStorageKey(next.accountId, next.origin);
          const stored = await browser.storage.local.get(key);
          if (!cancelled && request === generation && !active.current)
            setJob(
              restoreBookmarkImportJob(
                typeof stored[key] === "string" ? stored[key] : null,
                next.accountId,
                next.origin,
              ),
            );
        } else setIdentity(null);
        if (!safari) {
          const initialized = await initializeBookmarkConsent();
          const granted = await hasBookmarkPermission();
          if (cancelled || request !== generation) return;
          setConsent(initialized);
          setPermission(granted);
        }
      } catch (failure) {
        if (!cancelled) {
          setIdentity(null);
          setError((failure as Error).message);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    const changed = (changes: Record<string, unknown>) => {
      const credentialsChanged = Object.entries(changes).some(([key, value]) => {
        if (key === "apiUrl") return true;
        if (key !== "oauth" && !key.endsWith(":oauth")) return false;
        const change = value as { newValue?: { accessToken?: string } };
        return importAccountSubject(change.newValue?.accessToken ?? null) !== account.current;
      });
      if (credentialsChanged) {
        account.current = null;
        pause.current = true;
        setPreview(null);
        setJob(null);
        setIdentity(null);
        setSyncSettings(null);
        setBusy(false);
        void refresh();
      }
      if (Object.keys(changes).some((key) => key.endsWith("nativeBookmarkConsent")))
        void initializeBookmarkConsent().then((next) => {
          if (!cancelled) setConsent(next);
        });
    };
    const permissionsChanged = () => {
      void hasBookmarkPermission().then((granted) => {
        if (!cancelled) setPermission(granted);
      });
    };
    browser.storage.onChanged.addListener(changed);
    browser.permissions.onRemoved.addListener(permissionsChanged);
    browser.permissions.onAdded.addListener(permissionsChanged);
    void refresh();
    return () => {
      cancelled = true;
      account.current = null;
      pause.current = true;
      browser.storage.onChanged.removeListener(changed);
      browser.permissions.onRemoved.removeListener(permissionsChanged);
      browser.permissions.onAdded.removeListener(permissionsChanged);
    };
  }, [safari]);

  const openWeb = async (path: string) => {
    await browser.tabs.create({ url: `${await getWebBaseUrl()}${path}` });
  };
  const read = async () => {
    if (!identity || !consent) return;
    const owner = identity.accountId;
    setBusy(true);
    setError(null);
    try {
      // The request remains directly in the click handler, preserving the user gesture.
      const allowed = await browser.permissions.request({ permissions: ["bookmarks"] });
      if (account.current !== owner) return;
      setPermission(allowed);
      if (!allowed)
        throw new Error(
          "Bookmark access was not granted. You can still import an HTML file in the web app.",
        );
      const next = await readBrowserImportPreview(owner);
      if (account.current === owner) {
        setPreview(next);
        setVisibleCount(100);
      }
    } catch (failure) {
      if (account.current === owner) setError((failure as Error).message);
    } finally {
      if (account.current === owner) setBusy(false);
    }
  };
  const run = async (next: BookmarkImportJob) => {
    if (!identity || active.current) return;
    const owner = identity.accountId;
    const key = bookmarkImportStorageKey(owner, identity.origin);
    active.current = true;
    pause.current = false;
    setBusy(true);
    setError(null);
    try {
      await runBookmarkImportJob(next, {
        uuid: () => crypto.randomUUID(),
        apply: (request) => applyExtensionImportBatch(owner, request),
        isCurrentAccount: () => account.current === owner,
        shouldPause: () => pause.current,
        save: async (current) => {
          await browser.storage.local.set({ [key]: JSON.stringify(current) });
        },
        changed: setJob,
      });
    } finally {
      active.current = false;
      if (account.current === owner) setBusy(false);
    }
  };
  const signIn = async () => {
    try {
      if (!SUPABASE_AUTH) {
        await openWeb("/app/library?import=1");
        return;
      }
      const response = await browser.runtime.sendMessage({ type: "START_OAUTH" });
      if (response?.ok !== true) throw new Error("Could not open authorization. Try again.");
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const changeFutureSync = async (enabled: boolean) => {
    if (!identity || !consent) return;
    const owner = identity.accountId;
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        const granted = await browser.permissions.request({ permissions: ["bookmarks"] });
        if (account.current !== owner) return;
        setPermission(granted);
        if (!granted)
          throw new Error("Bookmark access was not granted. Future additions remain off.");
      }
      await setBookmarkAdditionsConsent(enabled);
      if (account.current !== owner) return;
      setConsent(await initializeBookmarkConsent());
      const settings = await readExtensionImportSyncSettings(owner);
      if (account.current === owner) setSyncSettings(settings ?? null);
    } catch (failure) {
      if (account.current === owner) setError((failure as Error).message);
    } finally {
      if (account.current === owner) setBusy(false);
    }
  };
  const futureEnabled =
    !!consent &&
    bookmarkMirroringAllowed(consent, permission, syncSettings?.nativeSyncEnabled === true);
  const removalsEnabled =
    !!consent &&
    bookmarkMirroringAllowed(
      consent,
      permission,
      syncSettings?.nativeSyncEnabled === true,
      "remove",
      syncSettings?.nativeSyncFull === true,
    );
  const counts = job ? bookmarkImportProgress(job) : null;
  const readyCount = preview ? preview.items.length - preview.existingCount : 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-5 text-foreground sm:p-8">
      <header>
        <p className="text-sm text-muted-foreground">Bookmark AI</p>
        <h1 className="mt-1 text-2xl font-semibold">Bring your bookmarks along</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Preview this browser's existing bookmarks, then choose when to import. Existing library
          links stay unchanged.
        </p>
      </header>
      <div aria-live="polite" className="flex flex-wrap gap-3 text-sm">
        <span>
          {!ready ? "Checking account…" : identity ? "Account connected" : "Sign-in needed"}
        </span>
        <span>
          {safari
            ? "Library access unavailable in Safari"
            : permission
              ? "Bookmark access allowed"
              : "Bookmark access not granted"}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!identity && ready && (
        <button className={button} onClick={() => void signIn()}>
          {SUPABASE_AUTH ? "Sign in to this extension" : "Continue import in the web app"}
        </button>
      )}
      {safari && (
        <p className="rounded-lg border p-4 text-sm">
          Safari extensions cannot read your iCloud bookmarks. On a Mac, export Bookmarks only from
          Safari, extract the ZIP, then import its bookmarks HTML file in the web app.
        </p>
      )}
      {!job && !preview && identity && !safari && (
        <section className="space-y-3 rounded-lg border p-5">
          <h2 className="font-medium">Read this browser's bookmarks</h2>
          <p className="text-sm text-muted-foreground">
            Access reads titles, URLs and folders for your preview. This does not enable future
            bookmark syncing or change browser bookmarks.
          </p>
          <button className={button} disabled={busy || !consent} onClick={() => void read()}>
            {busy
              ? "Reading bookmarks…"
              : permission
                ? "Preview bookmarks"
                : "Allow access and preview"}
          </button>
        </section>
      )}
      {preview && !job && (
        <section className="space-y-4">
          <h2 className="font-medium">{readyCount} ready to import</h2>
          <p className="text-sm text-muted-foreground">
            {preview.existingCount} already saved · {preview.duplicateCount} repeated ·{" "}
            {preview.invalidCount} invalid. Source folders will be kept.
          </p>
          <ul className="divide-y rounded-lg border">
            {preview.items.slice(0, visibleCount).map((item) => (
              <li key={item.key} className="p-3">
                <p className="break-words text-sm font-medium">{item.title}</p>
                <p className="break-all text-xs text-muted-foreground">{item.url}</p>
                <p className="break-words text-xs text-muted-foreground">
                  {item.folderPath.join(" / ") || "Unsorted"} ·{" "}
                  {item.status === "existing" ? "Already saved" : "Ready"}
                </p>
              </li>
            ))}
          </ul>
          {visibleCount < preview.items.length && (
            <button className={button} onClick={() => setVisibleCount((count) => count + 100)}>
              Show more
            </button>
          )}
          <div className="flex gap-2">
            <button className={button} onClick={() => setPreview(null)}>
              Back
            </button>
            <button
              className={button}
              disabled={busy || !readyCount || !identity}
              onClick={() =>
                identity &&
                void run(
                  createBookmarkImportJob(preview, {
                    id: crypto.randomUUID(),
                    ...identity,
                    browser: import.meta.env.BROWSER === "firefox" ? "firefox" : "chrome",
                    device: "desktop",
                    preserveFolders: true,
                  }),
                )
              }
            >
              Import {readyCount} links
            </button>
          </div>
        </section>
      )}
      {job && counts && (
        <section className="space-y-4 rounded-lg border p-5">
          <h2 className="font-medium" role="status">
            {job.status === "completed"
              ? counts.failed
                ? "Import finished with failures"
                : "Your links are ready"
              : busy
                ? "Importing…"
                : "Import paused"}
          </h2>
          <p className="text-sm">
            {counts.imported} imported · {counts.existing} already saved · {counts.failed} failed ·{" "}
            {counts.remaining} remaining
          </p>
          <progress
            className="w-full"
            max={Math.max(counts.total, 1)}
            value={counts.total - counts.remaining}
            aria-label="Import progress"
          />
          {job.error && (
            <p role="alert" className="text-sm text-destructive">
              {job.error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Keep this tab open while importing. If it closes, reopen Import from the extension to
            resume this account's saved progress.
          </p>
          {counts.failed > 0 && (
            <ul className="text-sm">
              {job.outcomes
                .filter((item) => item.status === "failed")
                .map((item) => (
                  <li className="mb-2 break-all" key={item.key}>
                    {item.url} — {item.error}
                  </li>
                ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {busy && (
              <button
                className={button}
                onClick={() => {
                  pause.current = true;
                }}
              >
                Pause after this batch
              </button>
            )}
            {!busy && counts.remaining > 0 && (
              <button className={button} onClick={() => void run(job)}>
                Resume import
              </button>
            )}
            {!busy && counts.failed > 0 && !job.pending && (
              <button className={button} onClick={() => void run(retryFailedBookmarkImports(job))}>
                Retry failed links
              </button>
            )}
            {!busy && job.status === "completed" && (
              <button
                className={button}
                onClick={async () => {
                  if (!identity) return;
                  await browser.storage.local.remove(
                    bookmarkImportStorageKey(identity.accountId, identity.origin),
                  );
                  setJob(null);
                  setPreview(null);
                }}
              >
                Start another import
              </button>
            )}
            <button className={button} onClick={() => void openWeb("/app/library")}>
              Find your imported links
            </button>
          </div>
        </section>
      )}
      {identity && !safari && (
        <section className="space-y-3 rounded-lg border p-5">
          <h2 className="font-medium">Future bookmarks on this browser</h2>
          <p role="status" className="text-sm">
            {syncSettings === null
              ? "Account sync setting could not be checked."
              : futureEnabled
                ? "Future additions enabled on this browser"
                : "Future additions off on this browser"}
          </p>
          <p className="text-sm text-muted-foreground">
            A separate choice copies new bookmarks you create after setup. It does not import older
            bookmarks. Importing above does not enable this.
          </p>
          {syncSettings?.nativeSyncEnabled === false && (
            <p className="text-sm">
              Native sync is off for your account. Turn it on in Settings → Sync before enabling
              this browser.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {removalsEnabled
              ? "Deletion mirroring is enabled from your previous setup: removing a browser bookmark also removes its saved copy when this install knows the link."
              : "Deletion mirroring is off on this browser. Enabling additions here keeps saved copies when browser bookmarks are removed, even if account full sync is on."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={
                busy || !consent || (!consent.additions && syncSettings?.nativeSyncEnabled !== true)
              }
              onClick={() => void changeFutureSync(!consent?.additions)}
            >
              {consent?.additions ? "Turn off on this browser" : "Enable future additions only"}
            </button>
            <button className={button} onClick={() => void openWeb("/app?settings=sync")}>
              Account sync settings
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                const owner = account.current;
                if (!owner) return;
                const settings = await readExtensionImportSyncSettings(owner);
                if (account.current === owner) setSyncSettings(settings ?? null);
              }}
            >
              Check setting again
            </button>
          </div>
        </section>
      )}
      <footer className="space-y-3 border-t pt-4">
        <button className={button} onClick={() => void openWeb("/app/library?import=1")}>
          Import a file or links from notes
        </button>
        <p className="text-xs text-muted-foreground">
          Future bookmark additions, reading-list capture and live tab sharing have separate
          settings. This import does not turn them on.
        </p>
      </footer>
    </main>
  );
}
