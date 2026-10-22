import { useCallback, useEffect, useRef, useState } from "react";
import type { OrganizationOperationInput } from "@bookmark-ai/types";
import { releaseCommand } from "@/lib/release-client";
import type { ReleaseReply } from "@/lib/release-background";
import {
  editChanges,
  editValues,
  supportedPage,
  type AskDraft,
  type EditDraft,
  type ReleaseRequest,
} from "@/lib/release-state";
import { detectSource } from "@/lib/detect";
import { domainOf, openBookmark, openSignIn } from "../nav";
import { HeroSaveCard, type TabInfo } from "./HeroSaveCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { QuickEditor } from "./QuickEditor";
import { Button } from "./ui/button";
import { ErrorNote } from "./ErrorNote";
import { fieldClass } from "./OrganizationPicker";

export function CapturePanel({
  tab,
  webUrl,
  saveRequest,
  sessionBusy,
  onBusy,
}: {
  tab: TabInfo | null;
  webUrl: string;
  saveRequest: number;
  sessionBusy: boolean;
  onBusy(busy: boolean): void;
}) {
  const page = { url: tab?.url ?? "", title: (tab?.title ?? tab?.url ?? "").slice(0, 2000) };
  const [data, setData] = useState<ReleaseReply>();
  const [mode, setMode] = useState<"main" | "edit" | "ask">("main");
  const [edit, setEdit] = useState<EditDraft>();
  const [ask, setAsk] = useState<AskDraft>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [held, setHeld] = useState(false);
  const [quickSave, setQuickSave] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [slow, setSlow] = useState(false);
  const alive = useRef(true);
  const version = useRef(0);
  const writes = useRef<Promise<unknown>[]>([]);
  const latestWrite = useRef(0);
  const seenCreate = useRef<string | undefined>(undefined);
  const seenSaveRequest = useRef(0);
  const pendingOpen = useRef<string | undefined>(undefined);
  const pending = data?.state.job?.status === "pending";
  const uncertain = data?.state.job?.status === "unknown";
  const busy = working || pending || sessionBusy;
  const savable = supportedPage(page.url);
  const job = data?.state.job;
  const bookmark = data?.state.bookmark;
  const org = data?.organization;
  const editable = org?.capabilities.organization === 1;
  const handoffSupported = org?.capabilities.handoff === 1;
  const current = (v: number) => alive.current && version.current === v;
  const fail = (e: unknown) => {
    if (alive.current) {
      setError(e instanceof Error ? e.message : "Request failed. Your draft is kept.");
      setHeld(true);
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  const load = useCallback(async () => {
    if (!supportedPage(tab?.url ?? "")) return;
    const v = ++version.current;
    setLoading(true);
    try {
      const next = await releaseCommand({
        action: "load",
        page: { url: tab!.url, title: (tab!.title ?? tab!.url).slice(0, 2000) },
      });
      if (!current(v)) return;
      setData(next);
      setError(undefined);
    } catch (e) {
      if (current(v)) fail(e);
    } finally {
      if (current(v)) setLoading(false);
    }
  }, [tab?.url]);
  useEffect(() => {
    setData(undefined);
    setEdit(undefined);
    setAsk(undefined);
    setMode("main");
    void load();
  }, [load]);
  useEffect(() => {
    onBusy(working || !!pending);
  }, [working, pending, onBusy]);
  // Local state polls never mutate or silently retry unknown outcomes. A fresh
  // popup load reconciles accepted requests, and Check result is explicit.
  useEffect(() => {
    if (!data) return;
    let disposed = false;
    const tick = async () => {
      try {
        const next = await releaseCommand({ action: "state", page, scope: data.scope });
        if (!disposed && alive.current)
          setData((old) => ({
            ...next,
            organization: old?.organization,
            organizationError: old?.organizationError,
          }));
      } catch (e) {
        if (!disposed) {
          version.current++;
          setWorking(false);
          setData(undefined);
          setEdit(undefined);
          setAsk(undefined);
          setMode("main");
          fail(e);
        }
      }
    };
    const timer = window.setInterval(() => void tick(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [data?.scope.accountId, data?.scope.origin]);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 1500);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (
      !quickSave ||
      held ||
      mode !== "main" ||
      error ||
      draftStatus ||
      data?.state.edit ||
      data?.state.ask ||
      job?.status !== "succeeded" ||
      job.request.kind !== "save"
    )
      return;
    const timer = window.setTimeout(() => window.close(), 1200);
    return () => window.clearTimeout(timer);
  }, [
    quickSave,
    held,
    mode,
    error,
    draftStatus,
    !!data?.state.edit,
    !!data?.state.ask,
    job?.status,
    job?.request.kind,
    job?.request.input.operationId,
  ]);

  function persist(field: "edit", value?: EditDraft): Promise<unknown>;
  function persist(field: "ask", value?: AskDraft): Promise<unknown>;
  function persist(field: "edit" | "ask", value?: EditDraft | AskDraft): Promise<unknown> {
    if (!data) return Promise.reject(new Error("Reconnect before editing."));
    const seq = ++latestWrite.current;
    setDraftStatus("Saving draft…");
    const promise = releaseCommand(
      field === "edit"
        ? { action: "draft", scope: data.scope, page, field, value: value as EditDraft | undefined }
        : { action: "draft", scope: data.scope, page, field, value: value as AskDraft | undefined },
    );
    writes.current.push(promise);
    void promise.then(
      () => {
        if (alive.current && seq === latestWrite.current)
          setDraftStatus("Draft saved on this device");
      },
      (e) => {
        if (alive.current) {
          setDraftStatus("Draft storage failed — keep this popup open and retry.");
          fail(e);
        }
      },
    );
    return promise;
  }
  const changeEdit = (next: EditDraft) => {
    setEdit(next);
    void persist("edit", next).catch(() => {});
  };
  async function submit(request: ReleaseRequest) {
    if (!data || busy || uncertain) return;
    const v = version.current;
    setWorking(true);
    setError(undefined);
    try {
      await Promise.all(writes.current);
      writes.current = [];
      if (request.kind === "handoff") pendingOpen.current = request.input.operationId;
      const next = await releaseCommand({ action: "submit", scope: data.scope, page, request });
      if (current(v)) setData((old) => ({ ...next, organization: old?.organization }));
    } catch (e) {
      if (current(v)) fail(e);
    } finally {
      if (current(v)) setWorking(false);
    }
  }
  async function save() {
    if (!data || busy || uncertain) return;
    if (bookmark) {
      setHeld(true);
      return;
    }
    setQuickSave(true);
    await submit({
      kind: "save",
      input: {
        operationId: crypto.randomUUID(),
        url: page.url,
        title: page.title,
        ...detectSource(),
      },
    });
  }
  useEffect(() => {
    if (data && saveRequest !== seenSaveRequest.current) {
      seenSaveRequest.current = saveRequest;
      void save();
    }
  }, [saveRequest, data?.scope.accountId]);
  function beginEdit() {
    if (!bookmark) return;
    setHeld(true);
    setMode("edit");
    const draft = data?.state.edit ?? { base: bookmark, values: editValues(bookmark) };
    setEdit(draft);
    void persist("edit", draft).catch(() => {});
  }
  function beginAsk() {
    setHeld(true);
    setMode("ask");
    const draft = data?.state.ask ?? { text: "", context: { type: "page" as const, ...page } };
    setAsk(draft);
    void persist("ask", draft).catch(() => {});
  }
  async function openHandoff() {
    if (!data || busy) return;
    setWorking(true);
    setError(undefined);
    try {
      await Promise.all(writes.current);
      await releaseCommand({ action: "open", scope: data.scope, page });
      if (alive.current) window.close();
    } catch (e) {
      fail(e);
    } finally {
      if (alive.current) setWorking(false);
    }
  }
  async function check() {
    if (!data) return;
    setWorking(true);
    setError(undefined);
    try {
      const next = await releaseCommand({ action: "check", scope: data.scope, page });
      if (alive.current) setData((old) => ({ ...next, organization: old?.organization }));
    } catch (e) {
      fail(e);
    } finally {
      if (alive.current) setWorking(false);
    }
  }
  // Creation and assignment are distinct. Stage the returned entity, never
  // mutate the saved bookmark as a side effect of creating a folder/label.
  useEffect(() => {
    if (
      job?.request.kind !== "create" ||
      job.status !== "succeeded" ||
      !job.result?.operation?.entityId ||
      seenCreate.current === job.request.input.operationId
    )
      return;
    seenCreate.current = job.request.input.operationId;
    void load();
  }, [job?.request.input.operationId, job?.status]);
  useEffect(() => {
    if (job?.status !== "succeeded") return;
    if (job.request.kind === "handoff" && pendingOpen.current === job.request.input.operationId) {
      pendingOpen.current = undefined;
      void openHandoff();
    }
    if (
      job.request.kind === "edit" &&
      edit &&
      JSON.stringify(editChanges(edit)) === JSON.stringify(job.request.input.changes)
    ) {
      setEdit(undefined);
      setMode("main");
      setDraftStatus("");
      setHeld(true);
    }
  }, [job?.status, job?.request.input.operationId]);
  const transferMatches = JSON.stringify(data?.state.transfer?.input.draft) === JSON.stringify(ask);
  const transfer = transferMatches ? data?.state.transfer?.handoff : undefined;
  return (
    <div
      className="space-y-3"
      onMouseEnter={() => {
        if (bookmark) setHeld(true);
      }}
      onMouseMove={() => {
        if (bookmark) setHeld(true);
      }}
      onFocusCapture={() => {
        if (bookmark) setHeld(true);
      }}
    >
      {mode === "edit" && edit && org ? (
        <QuickEditor
          currentBookmark={bookmark}
          draft={edit}
          organization={org}
          recentFolders={data?.state.recentFolders ?? []}
          job={job}
          busy={!!busy || !!uncertain}
          onChange={changeEdit}
          onSave={() =>
            void submit({
              kind: "edit",
              bookmarkId: edit.base.id,
              input: {
                operationId: crypto.randomUUID(),
                changes: editChanges(edit),
                expected: edit.base.fieldVersions,
              },
            })
          }
          onCreate={(input: OrganizationOperationInput) => void submit({ kind: "create", input })}
          onCancel={() => {
            void persist("edit", undefined)
              .then(() => {
                setEdit(undefined);
                setMode("main");
                setDraftStatus("");
              })
              .catch(fail);
          }}
          onKeep={() => {
            setMode("main");
            setDraftStatus("");
          }}
          onOpen={() => void openBookmark(webUrl, edit.base.id).catch(fail)}
          onRefresh={() => void load()}
        />
      ) : mode === "ask" && ask ? (
        <section className="space-y-3" aria-label="Ask about this page">
          <h2 className="text-sm font-semibold">Ask about this page</h2>
          <p className="break-words text-xs font-medium">
            {ask.context.type === "page" ? ask.context.title : page.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {domainOf(ask.context.type === "page" ? ask.context.url : page.url)} · fixed page
            context
          </p>
          <label className="block space-y-1 text-xs">
            Question (optional)
            <textarea
              className={`${fieldClass} min-h-24 resize-y`}
              maxLength={32000}
              value={ask.text}
              disabled={!!busy || !!uncertain}
              onChange={(event) => {
                const next = { ...ask, text: event.target.value };
                setAsk(next);
                void persist("ask", next).catch(() => {});
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Continue with a draft. Nothing is sent to AI yet. Add files in the app; restricted pages
            may not be readable. AI does not organize your library in this release.
          </p>
          {transfer ? (
            <>
              <p role="status" className="text-xs">
                Draft transferred.{" "}
                {Date.parse(transfer.expiresAt) < Date.now()
                  ? "An unclaimed transfer may have expired. Try opening or recreate it below."
                  : "Ready to open in the same account."}
              </p>
              <Button disabled={!!busy} onClick={() => void openHandoff()}>
                Open app / Retry opening
              </Button>
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() =>
                  void submit({
                    kind: "handoff",
                    input: { operationId: crypto.randomUUID(), draft: ask },
                  })
                }
              >
                Recreate expired transfer
              </Button>
            </>
          ) : (
            <Button
              disabled={!handoffSupported || !!busy || !!uncertain}
              onClick={() =>
                void submit({
                  kind: "handoff",
                  input: { operationId: crypto.randomUUID(), draft: ask },
                })
              }
            >
              Continue in app
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setMode("main");
                setDraftStatus("");
              }}
            >
              Keep draft
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy || !!uncertain}
              onClick={() =>
                void persist("ask", undefined)
                  .then(() => {
                    setAsk(undefined);
                    setMode("main");
                    setDraftStatus("");
                  })
                  .catch(fail)
              }
            >
              Discard draft
            </Button>
          </div>
        </section>
      ) : (
        <>
          {bookmark ? (
            <>
              {!dismissed ? (
                <ConfirmationCard variant="bookmark" bookmark={bookmark} />
              ) : (
                <p className="break-words text-sm font-medium">{bookmark.title}</p>
              )}
              <p role="status" className="break-words text-xs">
                {data?.state.existing ? "Already saved" : "Saved"} ·{" "}
                {bookmark.folderId
                  ? (org?.folders.find((folder) => folder.id === bookmark.folderId)?.path ??
                    "Saved folder (name unavailable)")
                  : "Unsorted"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  disabled={!editable || !!busy || !!uncertain}
                  onClick={beginEdit}
                >
                  {data?.state.edit ? "Resume edit" : "Edit details"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!editable || !!busy || !!uncertain}
                  onClick={beginEdit}
                >
                  Change folder
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void openBookmark(webUrl, bookmark.id).catch(fail)}
                >
                  View in library
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setHeld(true);
                    setQuickSave(false);
                    setDismissed(true);
                  }}
                >
                  Done
                </Button>
              </div>
            </>
          ) : (
            <HeroSaveCard
              tab={tab}
              saving={!!pending && job?.request.kind === "save"}
              savable={savable}
              busy={!!busy || !!uncertain || !data || loading}
              onSave={() => void save()}
            />
          )}
          {savable && (
            <Button
              variant="outline"
              disabled={!data || !handoffSupported || !!busy || !!uncertain}
              onClick={beginAsk}
            >
              {data?.state.ask ? "Resume question" : "Ask about this page"}
            </Button>
          )}
          {data?.state.edit && (
            <Button
              variant="ghost"
              disabled={!!busy || !!uncertain}
              onClick={() => void persist("edit", undefined).catch(fail)}
            >
              Discard saved edit draft
            </Button>
          )}
        </>
      )}
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Checking saved page and available organization…
        </p>
      )}
      {draftStatus && (
        <p role="status" className="text-xs text-muted-foreground">
          {draftStatus}
        </p>
      )}
      {(pending || working) && (
        <p role="status" className="text-xs">
          {slow
            ? "Still checking the result. Your page stays open; reopening recovers this request."
            : "Working… your page stays open."}
        </p>
      )}
      {job?.status === "succeeded" && job.request.kind === "edit" && (
        <p role="status" className="text-xs">
          Changes saved. Undo is available in the app’s Recent changes.
        </p>
      )}
      {job?.status === "succeeded" && job.request.kind === "create" && (
        <p role="status" className="text-xs">
          Created. Choose it in the picker, then Save changes to assign it.
        </p>
      )}
      {(uncertain || job?.status === "failed") && (
        <ErrorNote
          message={`${bookmark ? "Your link is saved. " : ""}${uncertain ? "Outcome unknown. Check result before retrying. " : "This change was not applied. "}${job?.error ?? ""}`}
        />
      )}
      {uncertain && (
        <Button variant="outline" disabled={!!working} onClick={() => void check()}>
          Check result / Retry same request
        </Button>
      )}
      {data?.organizationError && (
        <p className="text-xs text-muted-foreground">{data.organizationError}</p>
      )}
      {error && (
        <>
          <ErrorNote message={error} />
          <Button
            variant="outline"
            onClick={() => {
              writes.current = [];
              void load();
            }}
          >
            Reconnect / Check again
          </Button>
          <Button variant="ghost" onClick={() => void openSignIn(webUrl).catch(fail)}>
            Sign in again
          </Button>
        </>
      )}
    </div>
  );
}
