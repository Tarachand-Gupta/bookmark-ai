"use client";
import { useState } from "react";
import { Hash } from "lucide-react";
import type { OrganizationResponse } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const fieldClass = "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
export function TagsField({ tags, onChange, data, onCreate, disabled }: { tags: string[]; onChange: (tags: string[]) => void; data: OrganizationResponse; onCreate?: (name: string) => Promise<void>; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  return <div className="space-y-2"><span className="block text-sm font-medium"><Hash className="mr-1 inline size-4" aria-hidden />Tags · {tags.length}/10</span><div className="flex flex-wrap gap-1">{tags.map(tag => <Button key={tag} size="sm" className="min-h-11 min-w-11" type="button" variant="secondary" disabled={disabled} onClick={() => onChange(tags.filter(t => t !== tag))} aria-label={`Remove tag ${tag}`}>{tag} ×</Button>)}</div>
    <Input className="h-11" aria-label="Search or create tags" placeholder="Find or create a tag" value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} />
    <div className="max-h-28 overflow-auto flex flex-wrap gap-1">{data.tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase()) && !tags.includes(t.name)).map(t => <Button key={t.id} type="button" variant="outline" size="sm" className="min-h-11 min-w-11" disabled={disabled || tags.length >= 10} onClick={() => { onChange([...tags, t.name]); setQuery(""); }}>+ {t.name}</Button>)}</div>
    {!!query.trim() && !data.tags.some(t => t.name.toLowerCase() === query.trim().toLowerCase()) && onCreate && <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" disabled={disabled || tags.length >= 10} onClick={() => void onCreate(query.trim()).then(() => setQuery(""))}>Create “{query.trim()}”</Button>}
    {tags.length > 10 && <p className="text-xs text-muted-foreground">These existing tags are preserved. Remove tags to reach ten before adding another.</p>}
  </div>;
}
