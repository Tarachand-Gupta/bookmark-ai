"use client";

import { useEffect, useRef, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import {
  applyBookmarkBatch,
  previewBookmarkFile,
  previewBookmarkSource,
} from "@/lib/bookmark-import-client";

export interface ImportBookmarksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
  /** Only supplied by an authenticated host or a fixture harness. */
  accountId?: string;
}

export function ImportBookmarksDialog(props: ImportBookmarksDialogProps) {
  const auth = useAuth();
  return (
    <ImportBookmarksDialogContent key={props.accountId ?? auth.userId ?? "signed-out"} {...props} />
  );
}

function ImportBookmarksDialogContent({
  open,
  onOpenChange,
  onImported,
  accountId: accountOverride,
}: ImportBookmarksDialogProps) {
  const auth = useAuth();
  const accountId = accountOverride ?? auth.userId;
  const [preview, setPreview] = useState<BookmarkImportPreview | null>(null);
  const [job, setJob] = useState<BookmarkImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [preserveFolders, setPreserveFolders] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(100);
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;
  const pause = useRef(false);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewGeneration = useRef(0);
  const origin = typeof window === "undefined" ? API_URL : API_URL || window.location.origin;

  useEffect(() => {
    previewGeneration.current++;
    pause.current = true;
    setPreview(null);
    setJob(null);
    setText("");
    setError(null);
    setBusy(false);
    setExcluded(new Set());
    if (!open || !accountId) return;
    try {
      setJob(
        restoreBookmarkImportJob(
          localStorage.getItem(bookmarkImportStorageKey(accountId, origin)),
          accountId,
          origin,
        ),
      );
    } catch {
      setError(
        "Your browser could not open saved import progress. Allow local storage before importing.",
      );
    }
  }, [open, accountId, origin]);
  useEffect(
    () => () => {
      pause.current = true;
      currentAccount.current = null;
      previewGeneration.current++;
    },
    [],
  );

  const close = () => {
    pause.current = true;
    onOpenChange(false);
  };
  const showPreview = async (load: () => Promise<BookmarkImportPreview>, name: string) => {
    const generation = ++previewGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const next = await load();
      if (generation !== previewGeneration.current) return;
      setPreview(next);
      setSourceName(name);
      setExcluded(new Set());
      setVisibleCount(100);
    } catch (e) {
      if (generation === previewGeneration.current) setError((e as Error).message);
    } finally {
      if (generation === previewGeneration.current) setBusy(false);
    }
  };
  const run = async (candidate: BookmarkImportJob) => {
    if (running.current || !accountId) return;
    running.current = true;
    pause.current = false;
    setBusy(true);
    setError(null);
    const owner = accountId;
    try {
      const result = await runBookmarkImportJob(candidate, {
        apply: (request) => applyBookmarkBatch(request, owner),
        uuid: () => crypto.randomUUID(),
        shouldPause: () => pause.current,
        isCurrentAccount: () => currentAccount.current === owner,
        save: async (next) => {
          localStorage.setItem(bookmarkImportStorageKey(owner, origin), JSON.stringify(next));
        },
        changed: setJob,
      });
      if (
        currentAccount.current === owner &&
        result.outcomes.some((item) => item.status === "imported")
      )
        onImported?.();
    } finally {
      running.current = false;
      if (currentAccount.current === owner) setBusy(false);
    }
  };
  const start = () => {
    if (!preview || !accountId) return;
    const selected = { ...preview, items: preview.items.filter((item) => !excluded.has(item.key)) };
    void run(
      createBookmarkImportJob(selected, {
        id: crypto.randomUUID(),
        accountId,
        origin,
        browser: "other",
        device: "desktop",
        preserveFolders,
      }),
    );
  };
  const reset = () => {
    if (busy || !accountId) return;
    try {
      localStorage.removeItem(bookmarkImportStorageKey(accountId, origin));
      setJob(null);
      setPreview(null);
      setError(null);
      setText("");
    } catch {
      setError("Import progress could not be cleared. Check browser storage permissions.");
    }
  };
  const counts = job ? bookmarkImportProgress(job) : null;
  const readyCount =
    preview?.items.filter((item) => item.status === "ready" && !excluded.has(item.key)).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-5 pe-12">
          <DialogTitle>Import existing links</DialogTitle>
          <DialogDescription>
            Review before saving. Links already in your library stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {!accountId && (
            <p role="alert" className="text-sm">
              Sign in to your account before importing.
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {!job && !preview && (
            <div className="space-y-5">
              <div className="rounded-lg border p-4">
                <h3 className="font-medium">From a browser</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a bookmarks HTML export from Chrome, Firefox or Safari. No extension is
                  needed for a file import.
                </p>
                <Button
                  className="mt-3"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy || !accountId}
                >
                  Choose file
                </Button>
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  accept=".html,.htm,.md,.markdown,.txt"
                  aria-label="Choose bookmark import file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file)
                      void showPreview(
                        () => previewBookmarkFile(file, accountId ?? undefined),
                        file.name,
                      );
                  }}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  HTML, Markdown or text · up to 5 MB and 5,000 links
                </p>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium">How to export bookmarks</summary>
                  <ul className="mt-2 list-disc space-y-2 ps-5 text-muted-foreground">
                    <li>Chrome: Bookmark manager → menu → Export bookmarks.</li>
                    <li>
                      Firefox: Manage bookmarks → Import and Backup → Export Bookmarks to HTML.
                    </li>
                    <li>
                      Safari on Mac: File → Export Browsing Data to File → select Bookmarks only.
                      Extract the ZIP on your device, then choose the bookmarks HTML file. Older
                      Safari versions offer File → Export → Bookmarks.
                    </li>
                  </ul>
                  <p className="mt-2 text-muted-foreground">
                    Safari extensions cannot read your iCloud bookmark library. If iCloud already
                    syncs your bookmarks to a Mac, export the bookmarks visible there.
                  </p>
                </details>
              </div>
              <div>
                <label htmlFor="import-links-text" className="text-sm font-medium">
                  Links from notes or a list
                </label>
                <p className="mb-2 mt-1 text-sm text-muted-foreground">
                  Paste links or Markdown. Only web links are saved; note text and attachments
                  remain in the source app.
                </p>
                <textarea
                  id="import-links-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={5}
                  className="w-full rounded-md border bg-background p-3 text-sm"
                  placeholder="https://example.com&#10;[A useful page](https://example.org)"
                  disabled={busy}
                />
                <Button
                  variant="outline"
                  className="mt-2"
                  disabled={!text.trim() || busy || !accountId}
                  onClick={() =>
                    void showPreview(
                      () =>
                        previewBookmarkSource(
                          { action: "preview", source: "markdown", content: text },
                          accountId ?? undefined,
                        ),
                      "Pasted links",
                    )
                  }
                >
                  Preview links
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Restoring a Bookmark AI JSON backup? Use Settings → Data → Restore backup.
              </p>
            </div>
          )}
          {preview && !job && (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium break-words">{sourceName}</h3>
                <p className="mt-1 text-sm" role="status">
                  {readyCount} ready · {preview.existingCount} already saved ·{" "}
                  {preview.duplicateCount} repeated · {preview.invalidCount} invalid
                </p>
              </div>
              {preview.warnings.map((warning) => (
                <p key={warning} className="text-sm text-muted-foreground">
                  {warning}
                </p>
              ))}
              {preview.items.some((item) => item.folderPath.length) && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={preserveFolders}
                    onChange={(event) => setPreserveFolders(event.target.checked)}
                  />
                  <span>
                    Keep source folders. Matching folder paths are reused.
                    {!preserveFolders && (
                      <span className="block text-muted-foreground">
                        New links will go to Unsorted.
                      </span>
                    )}
                  </span>
                </label>
              )}
              {preview.items.length === 0 ? (
                <p>No usable web links were found. Choose another export or paste HTTP(S) links.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {preview.items.slice(0, visibleCount).map((item) => (
                    <li key={item.key} className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        aria-label={`Import ${item.title}`}
                        checked={!excluded.has(item.key)}
                        disabled={item.status === "existing"}
                        onChange={(event) =>
                          setExcluded((old) => {
                            const next = new Set(old);
                            if (event.target.checked) next.delete(item.key);
                            else next.add(item.key);
                            return next;
                          })
                        }
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium">{item.title}</p>
                        <p className="break-all text-xs text-muted-foreground">{item.url}</p>
                        {item.folderPath.length > 0 && (
                          <p className="break-words text-xs text-muted-foreground">
                            {item.folderPath.join(" / ")}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.status === "existing" ? "Already saved" : "Ready"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {visibleCount < preview.items.length && (
                <Button variant="ghost" onClick={() => setVisibleCount((value) => value + 100)}>
                  Show more ({preview.items.length - visibleCount})
                </Button>
              )}
            </div>
          )}
          {job && counts && (
            <div className="space-y-4">
              <div role="status" aria-live="polite">
                <h3 className="font-medium">
                  {job.status === "completed"
                    ? counts.failed
                      ? "Import finished with some failures"
                      : "Your links are ready"
                    : busy
                      ? "Importing links…"
                      : "Import paused"}
                </h3>
                <p className="mt-1 text-sm">
                  {counts.imported} imported · {counts.existing} already saved · {counts.failed}{" "}
                  failed · {counts.remaining} remaining
                </p>
              </div>
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
              {job.status !== "completed" && (
                <p className="text-sm text-muted-foreground">
                  Progress is saved for this account on this device. Closing pauses after the
                  current batch; reopen Import to continue.
                </p>
              )}
              {counts.failed > 0 && (
                <ul className="space-y-2">
                  {job.outcomes
                    .filter((item) => item.status === "failed")
                    .slice(0, 100)
                    .map((item) => (
                      <li key={item.key} className="rounded border p-3 text-sm">
                        <p className="break-all">{item.url}</p>
                        <p className="text-muted-foreground">{item.error}</p>
                      </li>
                    ))}
                </ul>
              )}
              {job.status === "completed" && (
                <p className="text-sm text-muted-foreground">
                  Find a saved title in Search, choose a folder, or ask AI about your library.
                </p>
              )}
            </div>
          )}
          {busy && !job && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Reading your links… Nothing is saved yet.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4">
          {!job && preview && (
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
              disabled={busy}
            >
              Choose another source
            </Button>
          )}
          {job?.status === "completed" && !busy && (
            <Button variant="ghost" onClick={reset}>
              Start another import
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            {busy && job
              ? "Pause and close"
              : job?.status === "completed"
                ? "Go to library"
                : "Later"}
          </Button>
          {!job && preview && (
            <Button onClick={start} disabled={busy || readyCount === 0 || !accountId}>
              Import {readyCount} links
            </Button>
          )}
          {job && !busy && counts && counts.remaining > 0 && (
            <Button onClick={() => void run(job)}>Resume import</Button>
          )}
          {job && !busy && counts && counts.failed > 0 && !job.pending && (
            <Button onClick={() => void run(retryFailedBookmarkImports(job))}>
              Retry {counts.failed} failed
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
