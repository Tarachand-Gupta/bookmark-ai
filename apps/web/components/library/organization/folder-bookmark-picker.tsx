"use client";
import { useState } from "react";
import { MAX_ORGANIZATION_SELECTION } from "@bookmark-ai/types";
import type { Bookmark, OrganizationFolder } from "@bookmark-ai/types";
import type { LibraryFilters } from "@/lib/api";
import { useBookmarks, useSearch } from "@/hooks/use-library";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const ALL_BOOKMARKS: LibraryFilters = {};

/** Selection is explicit and frozen as loaded objects, including versions. Search never selects hidden matches. */
export function FolderBookmarkPicker({ folder, initialSelection = [], initialQuery = "", onClose, onChoose }: { folder: OrganizationFolder; initialSelection?: Bookmark[]; initialQuery?: string; onClose: () => void; onChoose: (bookmarks: Bookmark[], query: string) => void }) {
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Map<string, Bookmark>>(() => new Map(initialSelection.map(bookmark => [bookmark.id, bookmark])));
  const list = useBookmarks(ALL_BOOKMARKS, 0);
  const search = useSearch(query, "text", 0);
  const searching = !!query.trim();
  const loading = searching ? search.loading : list.loading;
  const error = searching ? search.error : list.error;
  const rows = searching ? (search.data?.results ?? []).map(result => result.bookmark) : list.bookmarks ?? [];
  const available = rows.filter(bookmark => bookmark.folderId !== folder.id);
  const choose = (bookmarks: Bookmark[], toggle = false) => {
    const next = new Map(selected);
    for (const bookmark of bookmarks) {
      if (toggle && next.has(bookmark.id)) next.delete(bookmark.id); else next.set(bookmark.id, bookmark);
    }
    if (next.size > MAX_ORGANIZATION_SELECTION) { setSelectionError(`Select up to ${MAX_ORGANIZATION_SELECTION.toLocaleString()} bookmarks at a time. This selection was not changed.`); return; }
    setSelectionError(null); setSelected(next);
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="[&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:right-1 [&>[data-slot=dialog-close]]:top-1 [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:place-items-center flex max-h-[90dvh] min-h-0 flex-col sm:max-w-xl"><DialogHeader><DialogTitle>Add bookmarks</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">Choose saved links to move to <strong className="font-medium text-foreground">{folder.path}</strong>. Their topics and tags stay the same.</DialogDescription></DialogHeader>
    <Input autoFocus className="h-11 shrink-0" placeholder="Search saved bookmarks" aria-label="Search saved bookmarks to add" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{selected.size} selected</span><Button type="button" variant="ghost" className="min-h-11" disabled={loading || !available.length} onClick={() => choose(available)}>Select {available.length} loaded</Button>{selected.size > 0 && <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSelected(new Map())}>Clear</Button>}</div>
    <div className="min-h-0 overflow-y-auto overscroll-contain" aria-busy={loading}>
      {error ? <p role="alert" className="py-4 text-sm text-destructive">{error}</p> : loading ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading bookmarks…</p> : rows.length ? <ul className="divide-y">{rows.map(bookmark => <li key={bookmark.id}><label className="flex min-h-14 cursor-pointer items-center gap-3 px-1 py-2"><Checkbox disabled={bookmark.folderId === folder.id} checked={bookmark.folderId === folder.id || selected.has(bookmark.id)} onCheckedChange={() => choose([bookmark], true)} aria-label={`Select ${bookmark.title || bookmark.domain}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{bookmark.title || bookmark.url}</span><span className="block truncate text-xs text-muted-foreground">{bookmark.domain}{bookmark.folderId === folder.id ? " · Already in this folder" : ""}</span></span></label></li>)}</ul> : <p className="py-6 text-sm text-muted-foreground">{searching ? "No matching saved bookmarks." : "No saved bookmarks yet. Save a link or import your bookmarks to get started."}</p>}
      {!searching && list.hasMore && <Button type="button" variant="outline" className="my-3 min-h-11" disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? "Loading…" : "Load more bookmarks"}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{searching ? `${rows.length} loaded search results. Only links you select will move.` : `${rows.length} of ${list.total} bookmarks loaded. Only links you select will move.`}</p>
    {selectionError && <p role="alert" className="text-sm text-destructive">{selectionError}</p>}
    <DialogFooter className="shrink-0"><Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button><Button type="button" className="min-h-11" disabled={!selected.size} onClick={() => onChoose([...selected.values()], query)}>Review move · {selected.size}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
