"use client";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { bookmarkChangesSchema, type Bookmark, type OrganizationOperationInput, type OrganizationOperation, type OrganizationResponse } from "@bookmark-ai/types";
import { getBookmark, updateBookmark } from "@/lib/api";
import { changedBookmarkFields, expectedBookmarkVersions, operationSummary, readableCurrentValues } from "@/lib/organization-ui";
import { useAuth } from "@/lib/auth";
import { restoreBookmarkFocus } from "@/lib/bookmark-focus";
import { runOrganizationRequest } from "@/lib/organization-requests";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditorOrganizationField, EditorTagsField } from "./editor-fields";

export function BookmarkEditor({ bookmark, data, onClose, onResult, onRefresh }: { bookmark: Bookmark; data: OrganizationResponse; onClose: () => void; onResult: (operation: OrganizationOperation) => void; onRefresh: () => void }) {
  const { userId } = useAuth();
  const running = useRef(false);
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [createdLabels, setCreatedLabels] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState(bookmark);
  const [title, setTitle] = useState(bookmark.title); const [categoryId, setCategoryId] = useState(bookmark.categoryId ?? null); const [tags, setTags] = useState(bookmark.tags);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [receipt, setReceipt] = useState<OrganizationOperation | null>(null); const [created, setCreated] = useState<string | null>(null);
  const pending = useRef<Parameters<typeof updateBookmark>[1] | null>(null);
  const pendingLabel = useRef<{ kind: "category" | "tag"; name: string; input: OrganizationOperationInput } | null>(null);
  const changes = changedBookmarkFields(baseline, { title, categoryId, tags });
  const close = () => { if (running.current) return; if ((changes || pending.current || pendingLabel.current) && !window.confirm("Discard unsaved changes? Choose Cancel to keep editing.")) return; onClose(); };
  const save = async () => {
    if (running.current || !userId || pendingLabel.current || (!changes && !pending.current)) return;
    const parsed = bookmarkChangesSchema.safeParse(changes);
    if (!pending.current && !parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your changes."); return; }
    pending.current ??= { operationId: crypto.randomUUID(), changes: changes!, expected: expectedBookmarkVersions(baseline) };
    running.current = true; setBusy(true); setError(null);
    const finish = (operation: OrganizationOperation) => { pending.current = null; setReceipt(operation); onResult(operation); if (!operation.failedCount) onClose(); };
    try { finish(await runOrganizationRequest(userId, { kind: "bookmark", bookmarkId: bookmark.id, input: pending.current })); }
    catch (err) { if (err instanceof Error && "status" in err && [400,403,404,409,410,413,422].includes(Number(err.status))) pending.current = null; setError((err as Error).message); }
    finally { running.current = false; setBusy(false); }
  };
  const createLabel = async (kind: "category" | "tag", name: string) => {
    if (running.current || !userId) throw new Error("Please wait and try again.");
    if (kind === "tag" && tags.length >= 10) throw new Error("Remove a tag before adding another.");
    running.current = true; setBusy(true); setError(null);
    try {
      pendingLabel.current ??= { kind, name, input: { operationId: crypto.randomUUID(), action: `${kind}.create`, name } as OrganizationOperationInput };
      const operation = await runOrganizationRequest(userId, { kind: "organization", input: pendingLabel.current.input });
      pendingLabel.current = null; onResult(operation);
      if (operation.failedCount || !operation.entityId) throw new Error(operation.results.find(r => r.error)?.error?.message ?? "Could not create this label.");
      setCreated(`Created “${name}”.`);
      setCreatedLabels(previous => ({ ...previous, [operation.entityId!]: name }));
      if (kind === "category") setCategoryId(operation.entityId);
      else setTags(prev => prev.includes(name) ? prev : [...prev, name]);
      onRefresh();
    } catch (err) {
      if (err instanceof Error && "status" in err && [400,403,404,409,410,413,422].includes(Number(err.status))) pendingLabel.current = null;
      setError((err as Error).message);
      throw err; // Picker and retry handlers catch this and retain the draft.
    } finally { running.current = false; setBusy(false); }
  };
  const reviewLatest = async () => {
    if (running.current || pending.current || pendingLabel.current) return;
    running.current = true; setBusy(true);
    try {
      const { bookmark: current } = await getBookmark(bookmark.id);
      const proposed = changedBookmarkFields(baseline, { title, categoryId, tags });
      if (!proposed || !("title" in proposed)) setTitle(current.title);
      if (!proposed || !("categoryId" in proposed)) setCategoryId(current.categoryId ?? null);
      if (!proposed?.tags) setTags(current.tags);
      setBaseline(current); setReceipt(null);
      setError("Current values reloaded for comparison. Review your proposed fields, then save again.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't reload current values."); }
    finally { running.current = false; setBusy(false); }
  };
  const fieldsDisabled = busy || !!pending.current || !!pendingLabel.current;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(bookmark.url); setCopied(true); }
    catch { setCopied(false); setError("Couldn't copy the link. Select the URL to copy it manually."); }
  };
  return <Dialog open onOpenChange={value => { if (!value) close(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]" onCloseAutoFocus={event => { event.preventDefault(); restoreBookmarkFocus(bookmark.id); }} onInteractOutside={event => { if (changes || busy || pending.current || pendingLabel.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
        <DialogTitle className="pr-10 leading-6">Edit bookmark</DialogTitle>
        <DialogDescription className="sr-only">Edit the title, category, and tags.</DialogDescription>
        <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 size-11" aria-label="Close editor" disabled={busy} onClick={close}><X className="size-4" aria-hidden /></Button>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
      <fieldset disabled={fieldsDisabled} className="min-w-0 space-y-4">
        <div className="space-y-2"><Label htmlFor={titleId}>Title</Label><Input id={titleId} autoFocus value={title} onChange={event => setTitle(event.target.value)} className="h-11" /></div>
        <div className="space-y-1">
          <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/30 pl-3 pr-1">
            <span className="min-w-0 flex-1 select-all truncate text-sm text-muted-foreground" title={bookmark.url}>{bookmark.url}</span>
            <Button asChild variant="ghost" size="icon" className="size-11"><a href={bookmark.url} target="_blank" rel="noopener noreferrer" aria-label="Open link in a new tab"><ExternalLink className="size-4" aria-hidden /></a></Button>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={copied ? "Link copied" : "Copy link"} onClick={() => void copyLink()}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}</Button>
          </div>
          <span role="status" className="sr-only">{copied ? "Link copied to clipboard." : ""}</span>
        </div>
        <div className="min-w-0">
          <EditorOrganizationField label="Category" value={categoryId} emptyLabel="No category" options={data.categories} selectedLabel={categoryId ? createdLabels[categoryId] : undefined} onChange={setCategoryId} onCreate={name => createLabel("category", name)} disabled={fieldsDisabled} />
        </div>
        <EditorTagsField data={data} tags={tags} onChange={setTags} onCreate={name => createLabel("tag", name)} disabled={fieldsDisabled} />
      </fieldset>
    {pendingLabel.current && !busy && <Button variant="outline" className="mt-3 h-auto min-h-11 whitespace-normal" onClick={() => void createLabel(pendingLabel.current!.kind, pendingLabel.current!.name).catch(() => {})}>Retry same creation request</Button>}
    {created && <p role="status" className="mt-3 break-words text-sm text-muted-foreground">{created}</p>}{error && <p role="alert" className="mt-3 break-words text-sm text-destructive">{error}</p>}
    {receipt?.failedCount ? <div role="alert" className="mt-3 space-y-2 break-words text-sm"><p>{operationSummary(receipt)}</p>{receipt.results.filter(r => r.error).map(r => <div key={r.id}><p>{r.error?.message}</p>{r.error?.current && <div className="rounded border p-2 text-muted-foreground"><p>Currently saved:</p>{readableCurrentValues(r.error.current, data).map(field => <p key={field.label}><strong>{field.label}:</strong> {field.value}</p>)}<p className="mt-2">Your proposed changes remain in the fields above.</p></div>}</div>)}<Button variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy || !!pending.current || !!pendingLabel.current} onClick={() => void reviewLatest()}>Review against latest saved values</Button></div> : null}
      </div>
    <DialogFooter className="shrink-0 flex-row justify-end border-t bg-background px-5 py-3"><Button className="h-11" variant="outline" onClick={close} disabled={busy}>Cancel</Button><Button className="h-11" disabled={busy || !!pendingLabel.current || (!changes && !pending.current)} onClick={() => void save()}>{busy ? "Checking result…" : pending.current ? "Retry same update" : "Save changes"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
