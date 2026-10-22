"use client";
import { OrganizationPicker } from "./picker";
import { useState } from "react";
import { Folder, Hash, Inbox } from "lucide-react";
import type { OrganizationResponse } from "@bookmark-ai/types";
import { folderTreeRows, invalidFolderDestinations } from "@/lib/organization-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const fieldClass = "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function FolderField({ data, value, onChange, movingId, label = "Folder" }: { data: OrganizationResponse; value: string | null; onChange: (value: string | null) => void; movingId?: string; label?: string }) {
  const [query, setQuery] = useState("");
  const invalid = invalidFolderDestinations(data.folders, movingId);
  return <div className="space-y-2"><span className="block text-sm font-medium"><Folder className="mr-1 inline size-4" aria-hidden />{label}</span>{data.folders.length > 8 && <Input className="h-11" aria-label={`Search ${label.toLowerCase()} destinations`} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Search folder paths" value={query} onChange={e => setQuery(e.target.value)} />}
    <OrganizationPicker className={fieldClass} aria-label={label} value={value ?? ""} onValueChange={value => onChange(value || null)}>
      <option value="">{label === "Parent folder" ? <Folder className="size-4" aria-hidden /> : <Inbox className="size-4" aria-hidden />}{label === "Parent folder" ? "Top level" : "Unsorted"}</option>
      {folderTreeRows(data.folders).map(row => row.folder).filter(f => f.id === value || f.path.toLowerCase().includes(query.toLowerCase())).map(f => <option key={f.id} value={f.id} disabled={invalid.has(f.id)}><Folder className="size-4" aria-hidden />{f.path}{invalid.has(f.id) ? " — cannot move into itself or a child" : ""}</option>)}
    </OrganizationPicker>
  </div>;
}
export function TagsField({ tags, onChange, data, onCreate, disabled }: { tags: string[]; onChange: (tags: string[]) => void; data: OrganizationResponse; onCreate?: (name: string) => Promise<void>; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  return <div className="space-y-2"><span className="block text-sm font-medium"><Hash className="mr-1 inline size-4" aria-hidden />Tags · {tags.length}/10</span><div className="flex flex-wrap gap-1">{tags.map(tag => <Button key={tag} size="sm" className="min-h-11 min-w-11" type="button" variant="secondary" disabled={disabled} onClick={() => onChange(tags.filter(t => t !== tag))} aria-label={`Remove tag ${tag}`}>{tag} ×</Button>)}</div>
    <Input className="h-11" aria-label="Search or create tags" placeholder="Find or create a tag" value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} />
    <div className="max-h-28 overflow-auto flex flex-wrap gap-1">{data.tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase()) && !tags.includes(t.name)).map(t => <Button key={t.id} type="button" variant="outline" size="sm" className="min-h-11 min-w-11" disabled={disabled || tags.length >= 10} onClick={() => { onChange([...tags, t.name]); setQuery(""); }}>+ {t.name}</Button>)}</div>
    {!!query.trim() && !data.tags.some(t => t.name.toLowerCase() === query.trim().toLowerCase()) && onCreate && <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" disabled={disabled || tags.length >= 10} onClick={() => void onCreate(query.trim()).then(() => setQuery(""))}>Create “{query.trim()}”</Button>}
    {tags.length > 10 && <p className="text-xs text-muted-foreground">These existing tags are preserved. Remove tags to reach ten before adding another.</p>}
  </div>;
}
