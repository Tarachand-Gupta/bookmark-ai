"use client";

import type { OrganizationResponse } from "@bookmark-ai/types";
import type { LibraryFilters } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ViewToggle, type LibraryView } from "../view-toggle";

export function OrganizationLibraryControls({ data, filters, onFilters, count, onSelect, selected, onSelectLoaded, onSelectAll, selectingAll, search, onAddBookmarks, view, onViewChange }: {
  data: OrganizationResponse; filters: LibraryFilters; onFilters: (filters: LibraryFilters) => void;
  count: number | null; onSelect: () => void; selected: boolean;
  onSelectLoaded: () => void; onSelectAll: () => void; selectingAll: boolean; search: boolean;
  onAddBookmarks?: () => void; view?: LibraryView; onViewChange?: (view: LibraryView) => void;
}) {
  const folder = data.folders.find(f => f.id === filters.folderId);
  const hasChildren = folder && data.folders.some(f => f.parentId === folder.id);
  return <div className="mb-3 space-y-2">
    {filters.readingState && <div className="flex flex-wrap gap-2" role="group" aria-label="Reading list segments">{([['unread', 'Unread'], ['read', 'Read'], ['on_list', 'All']] as const).map(([value, label]) => <Button type="button" className="min-h-11 md:min-h-8" aria-pressed={filters.readingState === value} key={value} variant={filters.readingState === value ? "secondary" : "ghost"} onClick={() => onFilters({ ...filters, readingState: value })}>{label}</Button>)}</div>}
    <div className="flex flex-wrap items-center gap-2" aria-label={folder ? "Folder bookmarks toolbar" : "Bookmark toolbar"}>
      <p className="mr-auto text-sm text-muted-foreground">{count === null ? "Loading bookmarks…" : `${count} ${search ? "results" : count === 1 ? "bookmark" : "bookmarks"}`}</p>
      {hasChildren && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground md:min-h-8"><Checkbox checked={filters.includeSubfolders === "true"} onCheckedChange={checked => onFilters({ ...filters, includeSubfolders: String(checked === true) })} />Include subfolders</label>}
      {folder && <Button variant={selected ? "secondary" : "outline"} size="sm" className="min-h-11 md:hidden" type="button" onClick={onSelect}>{selected ? "Done" : "Select"}</Button>}
      {onAddBookmarks && !selected && <Button type="button" size="sm" className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" onClick={onAddBookmarks}>Add bookmarks</Button>}
      {view && onViewChange && <ViewToggle view={view} onChange={onViewChange} />}
    </div>
    {selected && <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" type="button" onClick={onSelectLoaded}>Select loaded items</Button><Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" type="button" disabled={selectingAll} onClick={onSelectAll}>{selectingAll ? "Preparing selection…" : search ? "Select ranked results…" : "Select all matching results…"}</Button></div>}
  </div>;
}
