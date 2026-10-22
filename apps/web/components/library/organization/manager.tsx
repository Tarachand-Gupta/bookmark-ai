"use client";

/* Hallmark · component scope · existing tokens · pre-emit critique: P5 H4 E3 S5 R5 V4.
 * Interaction/contrast/viewport proof remains with root browser QA. */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleDot, Folder, FolderInput, Hash, Merge, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { organizationOperationSchema, type OrganizationOperation, type OrganizationResponse } from "@bookmark-ai/types";
import { useOrganizationMutation } from "@/hooks/use-organization";
import { useAuth } from "@/lib/auth";
import { operationSummary, visibleFolderRows } from "@/lib/organization-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderField, fieldClass } from "./fields";
import { OrganizationPicker } from "./picker";

type Kind = "folder" | "category" | "tag";
type Edit = { action: "create" | "rename" | "move" | "remove" | "merge"; id?: string; oldName?: string; count?: number; expected?: Record<string, string>; initialDestination?: string | null };
type Props = { open: boolean; onClose: () => void; data: OrganizationResponse; onResult: (result: OrganizationOperation) => void; defaultParent?: string | null; initialAction?: "create-folder" };
const labels = { folder: "Folder", category: "Topic", tag: "Tag" };
const icons = { folder: Folder, category: CircleDot, tag: Hash };

export function OrganizationManager(props: Props) {
  const { userId } = useAuth();
  const account = useRef(userId);
  account.current = userId;
  // Drafts and delayed receipts belong only to the account that opened them.
  return <ManagerSession key={userId ?? "signed-out"} {...props} onResult={result => { if (userId && account.current === userId) props.onResult(result); }} />;
}

function ManagerSession({ open, onClose, data, onResult, defaultParent = null, initialAction }: Props) {
  const [kind, setKind] = useState<Kind>("folder");
  const [query, setQuery] = useState("");
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<string | null>(defaultParent);
  const [children, setChildren] = useState<"parent" | "destination">("parent");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OrganizationOperation | null>(null);
  const [discard, setDiscard] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasOpen = useRef(false);
  const mutation = useOrganizationMutation(result => { setReceipt(result); onResult(result); if (!result.failedCount) setEdit(null); });
  const rows = kind === "folder" ? data.folders : kind === "category" ? data.categories : data.tags;
  const Icon = icons[kind];
  const begin = (next: Edit, nextKind = kind) => {
    const folder = nextKind === "folder" ? data.folders.find(f => f.id === next.id) : undefined;
    const parent = nextKind === "folder" ? (folder ? folder.parentId : defaultParent) : null;
    mutation.reset(); setKind(nextKind); setEdit({ ...next, expected: folder?.fieldVersions, initialDestination: parent });
    setName(next.oldName ?? ""); setDestination(parent); setChildren("parent"); setError(null); setReceipt(null); setDiscard(false);
  };
  useEffect(() => {
    if (open && !wasOpen.current && initialAction === "create-folder" && !edit) begin({ action: "create" }, "folder");
    wasOpen.current = open;
  }, [open, initialAction]);
  useEffect(() => {
    if (!open) return;
    if (edit) formRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus();
    else searchRef.current?.focus();
  }, [open, edit]);

  const submit = () => {
    if (!edit || mutation.busy) return;
    if (mutation.uncertain) { mutation.retry(); return; }
    const operationId = crypto.randomUUID();
    let input: unknown;
    if (edit.action === "create") input = { operationId, action: `${kind}.create`, name: name.trim(), ...(kind === "folder" ? { parentId: destination } : {}) };
    else if (edit.action === "rename") {
      const existing = rows.find(r => r.id !== edit.id && r.name.toLowerCase() === name.trim().toLowerCase());
      if (kind === "tag" && existing) { setEdit({ ...edit, action: "merge" }); setDestination(existing.id); setError("That tag exists. Review the merge into the surviving tag below."); return; }
      input = kind === "folder" ? { operationId, action: "folder.update", id: edit.id, name: name.trim(), expected: edit.expected } : { operationId, action: `${kind}.rename`, id: edit.id, name: name.trim() };
    } else if (edit.action === "move") input = { operationId, action: "folder.update", id: edit.id, parentId: destination, expected: edit.expected };
    else if (edit.action === "merge") input = { operationId, action: "tag.merge", sourceId: edit.id, targetId: destination };
    else input = { operationId, action: `${kind}.remove`, id: edit.id, ...(kind === "folder" ? { destinationId: destination, children } : kind === "category" ? { replacementId: destination } : {}) };
    const parsed = organizationOperationSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the selected values."); return; }
    setError(null); void mutation.run(parsed.data);
  };
  const childCount = edit?.id ? data.folders.filter(f => f.parentId === edit.id).length : 0;
  const dirty = !!edit && (name !== (edit.oldName ?? "") || destination !== edit.initialDestination || children !== "parent");
  const back = () => {
    if (mutation.busy) return;
    if (mutation.uncertain) { setError("This request is awaiting confirmation. Retry the same request before starting another change. You can close this window and return to it."); return; }
    if (dirty) { setDiscard(true); return; }
    mutation.reset(); setEdit(null); setError(null);
  };
  const close = () => { if (!mutation.busy) { setDiscard(false); onClose(); } };
  const visible = kind === "folder"
    ? visibleFolderRows(data.folders, closedFolders, query).map(row => ({ ...row, item: row.folder }))
    : rows.filter(row => row.name.toLowerCase().includes(query.trim().toLowerCase())).map(item => ({ item, depth: 0, hasChildren: false }));

  return <Dialog open={open} onOpenChange={visible => { if (!visible) close(); }}>
    <DialogContent showCloseButton={false} className="flex h-[min(42rem,calc(100dvh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}>
      <DialogHeader className="shrink-0 border-b p-4 pr-16 text-left sm:px-6">
        <DialogTitle>Organize library</DialogTitle>
        <DialogDescription>Folders are where links live. Topics and tags describe what they’re about.</DialogDescription>
      </DialogHeader>
      <Button type="button" variant="ghost" className="absolute right-2 top-2 size-11" aria-label="Close organizer" disabled={mutation.busy} onClick={close}><X aria-hidden /></Button>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [@media(max-height:500px)]:block">
      <div role="group" aria-label="Organization types" className="flex shrink-0 gap-1 border-b px-4 py-2 sm:px-6">
        {(["folder", "category", "tag"] as const).map(value => { const TypeIcon = icons[value]; return <Button type="button" aria-pressed={kind === value} key={value} className="min-h-11 flex-1 sm:flex-none" variant={kind === value ? "secondary" : "ghost"} disabled={!!edit} onClick={() => { setKind(value); setQuery(""); setReceipt(null); }}><TypeIcon aria-hidden />{value === "category" ? "Topics" : value === "folder" ? "Folders" : "Tags"}</Button>; })}
      </div>
      {!edit ? <>
        <div className="shrink-0 space-y-3 px-4 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground">{kind === "folder" ? "Nest folders to keep related links together. Counts include subfolders." : kind === "category" ? "Give each link a topic, wherever it lives in your folders." : "Use several tags to connect links across folders and topics."}</p>
          <div className="flex gap-2"><Input ref={searchRef} className="h-11 min-w-0" aria-label={`Search ${kind === "category" ? "topics" : `${kind}s`}`} placeholder={kind === "folder" ? "Search names or paths" : "Search names"} value={query} onChange={e => setQuery(e.target.value)} /><Button type="button" className="h-11 shrink-0" onClick={() => begin({ action: "create" })}><Plus aria-hidden /><span>New {labels[kind].toLowerCase()}</span></Button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6" aria-label={`${labels[kind]} list`}>
          <ul className="divide-y">{visible.map(({ item, depth, hasChildren }) => <li key={item.id} className="flex min-h-12 min-w-0 items-center gap-1" style={{ paddingLeft: query.trim() ? 0 : Math.min(depth, 5) * 16 }}>
            {kind === "folder" && (hasChildren && !query.trim() ? <Button type="button" variant="ghost" className="size-11 shrink-0" aria-label={`${closedFolders.has(item.id) ? "Expand" : "Collapse"} ${item.name}`} aria-expanded={!closedFolders.has(item.id)} onClick={() => setClosedFolders(previous => { const next = new Set(previous); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}><ChevronRight aria-hidden className={closedFolders.has(item.id) ? "size-4" : "size-4 rotate-90"} /></Button> : <span className="w-11 shrink-0" aria-hidden />)}
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1 px-2 py-2"><p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>{kind === "folder" && query.trim() && <p className="break-words text-xs text-muted-foreground" title={data.folders.find(f => f.id === item.id)?.path}>{data.folders.find(f => f.id === item.id)?.path}</p>}</div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={`${item.count} bookmarks`}>{item.count}</span>
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="size-11 shrink-0" aria-label={`Actions for ${item.name}`}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" collisionPadding={12} onCloseAutoFocus={event => { if (formRef.current) { event.preventDefault(); formRef.current.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus(); } }}>
              <DropdownMenuItem className="min-h-11" onSelect={() => begin({ action: "rename", id: item.id, oldName: item.name, count: item.count })}><Pencil aria-hidden />Rename {labels[kind].toLowerCase()}</DropdownMenuItem>
              {kind === "folder" && <DropdownMenuItem className="min-h-11" onSelect={() => begin({ action: "move", id: item.id, oldName: item.name, count: item.count })}><FolderInput aria-hidden />Move folder</DropdownMenuItem>}
              {kind === "tag" && <DropdownMenuItem className="min-h-11" disabled={data.tags.length < 2} onSelect={() => begin({ action: "merge", id: item.id, oldName: item.name, count: item.count })}><Merge aria-hidden />Merge into another tag</DropdownMenuItem>}
              <DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => begin({ action: "remove", id: item.id, oldName: item.name, count: item.count })}><Trash2 aria-hidden />Remove {labels[kind].toLowerCase()}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          </li>)}</ul>
          {!visible.length && <div className="py-12 text-center"><Icon className="mx-auto mb-3 size-5 text-muted-foreground" aria-hidden /><p className="text-sm font-medium">{rows.length ? "No matching names or paths" : `No ${kind === "category" ? "topics" : `${kind}s`} yet`}</p><p className="mt-1 text-sm text-muted-foreground">{rows.length ? "Try a shorter search, or clear it to see everything." : `Use New ${labels[kind].toLowerCase()} above to get started.`}</p>{rows.length > 0 && <Button type="button" variant="ghost" className="mt-2 min-h-11" onClick={() => setQuery("")}>Clear search</Button>}</div>}
        </div>
      </> : <form ref={formRef} className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:px-6">
          <h3 className="break-words font-medium">{edit.action === "create" ? "New" : edit.action[0].toUpperCase() + edit.action.slice(1)} {labels[kind].toLowerCase()}{edit.oldName ? ` · ${edit.oldName}` : ""}</h3>
          <fieldset disabled={mutation.busy || !!mutation.uncertain} className="min-w-0 space-y-4">
            {(edit.action === "create" || edit.action === "rename") && <label className="block text-sm">Name<Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-11" maxLength={kind === "tag" ? 40 : 80} aria-required aria-invalid={!!error} /></label>}
            {kind === "folder" && ["create", "move", "remove"].includes(edit.action) && <FolderField data={data} value={destination} onChange={setDestination} movingId={edit.id} label={edit.action === "remove" ? "Move bookmarks to" : "Parent folder"} />}
            {kind === "folder" && edit.action === "remove" && <><p className="text-sm">{data.folders.find(f => f.id === edit.id)?.directCount ?? 0} directly assigned bookmarks move to the chosen destination. {Math.max(0, (edit.count ?? 0) - (data.folders.find(f => f.id === edit.id)?.directCount ?? 0))} bookmarks remain inside their child folders; {childCount} direct child folders are relocated below. Saved links are kept.</p><label className="block text-sm">Child folders<OrganizationPicker aria-label="Child folders" className={fieldClass} value={children} onValueChange={value => setChildren(value as "parent" | "destination")}><option value="parent">Move to this folder’s parent</option><option value="destination">Move to the chosen destination</option></OrganizationPicker></label><p className="text-xs text-muted-foreground">Name collisions must be resolved before removal. No trees are merged silently.</p></>}
            {kind === "category" && edit.action === "remove" && <label className="block text-sm">Replacement for {edit.count} bookmarks<OrganizationPicker aria-label="Replacement topic" className={fieldClass} value={destination ?? ""} onValueChange={value => setDestination(value || null)}><option value="">No topic</option>{data.categories.filter(c => c.id !== edit.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</OrganizationPicker></label>}
            {kind === "tag" && edit.action === "merge" && <label className="block text-sm">Surviving tag<OrganizationPicker aria-label="Surviving tag" className={fieldClass} value={destination ?? ""} onValueChange={value => setDestination(value || null)}><option value="">Choose a tag</option>{data.tags.filter(t => t.id !== edit.id).map(t => <option key={t.id} value={t.id}>{t.name} · {t.count} bookmarks</option>)}</OrganizationPicker><p className="mt-2 text-xs text-muted-foreground">Merge “{edit.oldName}” ({edit.count} bookmarks) into “{data.tags.find(t => t.id === destination)?.name ?? "…"}”. Shared memberships are deduplicated; saved links retain their identity.</p></label>}
            {edit.action !== "create" && kind !== "folder" && <p className="text-sm">This affects {edit.count} bookmarks across the library. Saved links are kept.</p>}
            {kind === "folder" && ["rename", "move"].includes(edit.action) && <p className="text-sm text-muted-foreground">This updates the folder for {edit.count} bookmarks, including its subfolders. Saved links are kept.</p>}
          </fieldset>
          {discard && <div role="alert" className="space-y-2 rounded-md border p-3 text-sm"><p>Discard these unsaved edits?</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" autoFocus onClick={() => setDiscard(false)}>Keep editing</Button><Button type="button" variant="ghost" className="min-h-11" onClick={() => { mutation.reset(); setEdit(null); setError(null); setDiscard(false); }}>Discard edits</Button></div></div>}
        </div>
        <div className="shrink-0 space-y-2 border-t p-4 sm:px-6"><p className="text-xs text-muted-foreground">Closing keeps this form while this page stays open. Confirmed changes can be undone in Recent changes.</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={mutation.busy} onClick={back}>Back</Button><Button type="submit" className="min-h-11" disabled={mutation.busy || (edit.action === "merge" && !destination) || (!mutation.uncertain && ["create", "rename"].includes(edit.action) && !name.trim())}>{mutation.busy ? "Checking result…" : mutation.uncertain ? "Retry same request" : edit.action === "create" ? `Create ${labels[kind].toLowerCase()}` : edit.action === "remove" ? `Remove ${labels[kind].toLowerCase()}` : edit.action === "merge" ? "Merge tags" : "Save change"}</Button></div></div>
      </form>}
      {(error || mutation.error || receipt) && <div className="max-h-28 shrink-0 space-y-1 overflow-y-auto border-t px-4 py-3 text-sm sm:px-6">{(error || mutation.error) && <p role="alert" className="text-destructive">{error || mutation.error}</p>}{receipt && <div role="status"><p>{operationSummary(receipt)}</p>{receipt.results.filter(r => r.error).map(r => <p key={r.id}>{r.error?.message}</p>)}</div>}</div>}
      </div>
    </DialogContent>
  </Dialog>;
}
