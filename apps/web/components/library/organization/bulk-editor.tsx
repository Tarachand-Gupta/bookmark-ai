"use client";
import { OrganizationPicker } from "./picker";
import { CircleDot } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { applyOrganizationOperation, getOrganizationOperation } from "@/lib/api";
import { batchStorageKey, createBatchJob, runBatchJob, type OrganizationBatchJob } from "@/lib/organization-batches";
import type { Bookmark, BulkBookmarkChanges, OrganizationResponse, OrganizationOperation } from "@bookmark-ai/types";
import { bulkChangeDescription, bulkDestination, clearCompletedBulkJob, readPendingBulkJob, recoverBulkJob, reserveBulkJob, saveOwnedBulkJob } from "@/lib/bulk-editor-state";
import { onExplicitSignOut } from "@/lib/account-private-state";
import { mixedTags } from "@/lib/organization-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TagsField, fieldClass } from "./fields";
export type BulkAction = "category" | "tags";
export function BulkEditor({ action, ids, bookmarks, data, expected, initialDestination, resumeJob, onClose, onBack, onResult }: { action: BulkAction; ids: string[]; bookmarks: Bookmark[]; data: OrganizationResponse; expected?: Record<string, Record<string, string>>; initialDestination?: string | null; resumeJob?: OrganizationBatchJob | null; onClose: () => void; onBack?: () => void; onResult: (operation: OrganizationOperation) => void }) {
  const [destination, setDestination] = useState<string | null | undefined>(initialDestination); const [tags, setTags] = useState<string[]>([]); const [mode, setMode] = useState<"addTags" | "removeTags">("addTags");
  const { userId } = useAuth();
  const [job, setJob] = useState<OrganizationBatchJob | null>(() => resumeJob ?? null);
  const [pending, setPending] = useState<OrganizationBatchJob | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false); const [batchError, setBatchError] = useState<string | null>(null);
  const [started, setStarted] = useState(false); const [draftStarted, setDraftStarted] = useState(!!resumeJob);
  const pause = useRef(false); const running = useRef(false); const mounted = useRef(true);
  const signedOut = useRef(false);
  const originalAccount = useRef(userId); const account = useRef(userId); account.current = userId;
  const sameAccount = !!userId && userId === originalAccount.current;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pause.current = true; }; }, []);
  useEffect(() => {
    if (!sameAccount) { pause.current = true; onClose(); }
  }, [sameAccount, onClose]);
  useEffect(() => {
    if (!userId || !sameAccount) return;
    const refresh = () => {
      try { setPending(readPendingBulkJob(localStorage, userId)); setStorageError(null); }
      catch (error) { setStorageError((error as Error).message); }
    };
    const storageChanged = (event: StorageEvent) => { if (event.key === batchStorageKey(userId) || event.key === null) refresh(); };
    refresh(); window.addEventListener("storage", storageChanged); window.addEventListener("bookmark-batch-changed", refresh);
    const unsubscribe = onExplicitSignOut(userId, () => { signedOut.current = true; pause.current = true; setPending(null); setJob(null); onClose(); });
    return () => { unsubscribe(); window.removeEventListener("storage", storageChanged); window.removeEventListener("bookmark-batch-changed", refresh); };
  }, [userId, sameAccount, onClose]);
  const runJob = async (requested: OrganizationBatchJob, isNew = false) => {
    if (running.current || signedOut.current || !sameAccount || requested.accountId !== userId) return;
    running.current = true; pause.current = false; setBatchBusy(true); setBatchError(null);
    let revoked = false;
    // This listener outlives a closed dialog until its accepted batch settles.
    const unsubscribe = onExplicitSignOut(requested.accountId, () => { revoked = true; pause.current = true; });
    const changed = () => window.dispatchEvent(new Event("bookmark-batch-changed"));
    try {
      if (!navigator.locks) throw new Error("This browser cannot safely coordinate saved changes. Use a browser with Web Locks support.");
      await navigator.locks.request(batchStorageKey(requested.accountId), { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("This account has a change running in another window. Wait for it to pause or finish.");
        if (revoked || signedOut.current || pause.current || account.current !== requested.accountId) return;
        let current = requested;
        if (isNew) {
          reserveBulkJob(localStorage, current);
          setDraftStarted(true);
        } else {
          const saved = readPendingBulkJob(localStorage, current.accountId);
          if (saved?.id !== current.id) throw new Error("The saved change has changed. Close and reopen to review it.");
          current = saved;
        }
        setStarted(true); setJob(current); changed();
        const dependencies = {
          apply: (input: Parameters<typeof applyOrganizationOperation>[0]) => applyOrganizationOperation(input, current.accountId),
          reconcile: (id: string) => getOrganizationOperation(id, current.accountId),
          save: (next: OrganizationBatchJob) => {
            if (revoked) throw new Error("This account signed out.");
            saveOwnedBulkJob(localStorage, next);
            if (mounted.current && account.current === current.accountId) setJob({ ...next, batches: [...next.batches] });
            changed();
          },
          shouldPause: () => pause.current || revoked || account.current !== current.accountId,
          onReceipt: (receipt: OrganizationOperation) => { if (!revoked && account.current === current.accountId) onResult(receipt); },
        };
        const available = "categoryId" in current.changes ? bulkDestination("category", current.changes.categoryId, data).valid : true;
        if (isNew) await runBatchJob(current, dependencies);
        else await recoverBulkJob(current, available, dependencies);
        if (current.state === "complete" && !revoked) { clearCompletedBulkJob(localStorage, current); changed(); }
      });
    } catch (error) { if (mounted.current && account.current === requested.accountId) setBatchError((error as Error).message); }
    finally { unsubscribe(); running.current = false; if (mounted.current) setBatchBusy(false); }
  };
  const close = () => { pause.current = true; onClose(); };
  const selected = bookmarks.filter(b => ids.includes(b.id)); const categories = new Set(selected.map(b => b.category));
  const destinationState = bulkDestination("category", destination, data);
  const apply = () => {
    if (!sameAccount || pending || storageError || ((action === "category") && !destinationState.valid)) return;
    const changes: BulkBookmarkChanges = action === "category" ? { categoryId: destination! } : { [mode]: tags };
    try {
      const current = createBatchJob(userId!, ids, changes, data.capabilities.maxOperationItems ?? 500, expected);
      void runJob(current, true);
    } catch (error) { setBatchError((error as Error).message); }
  };
  const displayAction = job ? "categoryId" in job.changes ? "category" : "tags" : action;
  const frozenDescription = job ? bulkChangeDescription(job.changes, data) : "";
  const selectedCount = job?.bookmarkIds.length ?? ids.length;
  const selectionLabel = `${selectedCount} bookmark${selectedCount === 1 ? "" : "s"}`;
  const actionLabel = action === "category" ? `Set category for ${selectionLabel}` : mode === "addTags" ? "Add tags" : "Remove tags";
  if (!sameAccount) return null;
  return <Dialog open onOpenChange={visible => { if (!visible) close(); }}><DialogContent className="[&_button]:min-h-11 max-h-[92dvh] overflow-y-auto"><DialogHeader><DialogTitle>{displayAction === "tags" ? "Edit tags" : "Set category"}</DialogTitle><DialogDescription>{selectedCount} selected · {job ? "This saved change keeps its original selection and category or tags." : displayAction === "category" ? "Choose one category for these bookmarks." : "Add or remove tags on these bookmarks."}</DialogDescription></DialogHeader>
    {!job && pending && <div className="rounded border p-3 text-sm space-y-2" role="status"><p className="font-medium">A previous change is saved for this account</p><p>{bulkChangeDescription(pending.changes, data)} · {pending.bookmarkIds.length} bookmarks</p><p>{pending.batches.filter(batch => batch.receipt).length} of {pending.batches.length} groups confirmed · {pending.state === "unknown" ? "Awaiting confirmation" : "Pending recovery"}</p><p>Your new selection and destination are kept here. Resolve the saved change before applying this edit.</p><Button variant="outline" onClick={() => { setJob(pending); setBatchError(null); }}>View saved change</Button></div>}
    {job && !draftStarted && <div className="text-sm space-y-2"><p>Viewing a previous change. Your new edit for {ids.length} bookmarks is kept separately.</p><Button variant="outline" disabled={batchBusy} onClick={() => { setJob(null); setBatchError(null); }}>Return to new edit</Button></div>}
    {storageError && <p role="alert" className="text-sm text-destructive">{storageError}</p>}
    <fieldset className={job ? "hidden" : "space-y-4"} disabled={batchBusy || !!job}>
      {action === "category" && <><p className="text-sm text-muted-foreground">{categories.size > 1 ? "Multiple categories" : [...categories][0] || "No category"}</p><label className="block text-sm"><CircleDot className="mr-1 inline size-4" aria-hidden />Category<OrganizationPicker aria-label="Category" className={fieldClass} value={destination === undefined ? "__choose__" : destination ?? ""} onValueChange={value => setDestination(value || null)}><option value="__choose__" disabled>Choose a category…</option>{destination != null && !destinationState.valid && <option value={destination} disabled>Category no longer available — choose another category</option>}<option value="">No category</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</OrganizationPicker></label></>}
      {action === "tags" && <><label className="block text-sm">What would you like to do?<OrganizationPicker aria-label="Tag action" value={mode} className={fieldClass} onValueChange={value => { setMode(value as "addTags" | "removeTags"); setTags([]); }}><option value="addTags">Add tags</option><option value="removeTags">Remove tags from selection</option></OrganizationPicker></label><div className="text-xs text-muted-foreground">{mixedTags(selected).map(tag => <span key={tag.name} className="mr-3">{tag.name}: {tag.state === "common" ? "on all loaded selected items" : `on ${tag.count} selected items`}</span>)}</div><TagsField data={data} tags={tags} onChange={setTags} /></>}
    </fieldset>
    {job && <div role="status" className="rounded border p-3 text-sm space-y-1"><p className="font-medium">{frozenDescription}</p><p>{job.batches.filter(b => b.receipt).length} of {job.batches.length} groups confirmed · {{ ready: "Ready to start", running: "Applying changes", paused: "Paused", unknown: "Awaiting confirmation", complete: "Finished" }[job.state]}</p><p>{job.batches.reduce((n, b) => n + (b.receipt?.succeededCount ?? 0), 0)} changed · {job.batches.reduce((n, b) => n + (b.receipt?.failedCount ?? 0), 0)} need review</p>{job.error && <p>{job.error}</p>}<p>Review and retry individual items in Recent changes.</p></div>}
    {!job && ids.length > (data.capabilities.maxOperationItems ?? 500) && <p className="text-xs text-muted-foreground">This large selection will be updated in steps. You can pause after a step finishes; completed changes remain available in Recent changes.</p>}
    {batchError && <p role="alert" className="text-sm text-destructive">{batchError}</p>}
    <DialogFooter>{onBack && !started && !job && <Button variant="outline" disabled={batchBusy} onClick={onBack}>Back to selection</Button>}<Button variant="outline" onClick={close}>{batchBusy ? "Pause and close" : job?.state === "complete" ? "Done" : "Cancel"}</Button>{(job?.state !== "complete" || (!!job && pending?.id === job.id)) && <Button disabled={batchBusy || !!storageError || (!job && (!!pending || !ids.length || (action === "tags" && !tags.length) || ((action === "category") && !destinationState.valid)))} onClick={() => job ? void runJob(job) : apply()}>{batchBusy ? "Checking and applying…" : job ? job.state === "complete" ? "Finish recovery" : "Check and resume saved change" : actionLabel}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
