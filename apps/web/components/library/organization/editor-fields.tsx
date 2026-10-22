"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import type { OrganizationResponse } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const popoverClass = "w-[var(--radix-popover-trigger-width)] min-w-0 max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0";

/** Editor-only picker: creation is a separate form, never a button inside an option. */
export function EditorOrganizationField({ label, value, options, emptyLabel, selectedLabel, onChange, onCreate, disabled }: {
  label: "Category";
  value: string | null;
  options: { id: string; name: string }[];
  emptyLabel: string;
  selectedLabel?: string;
  onChange: (value: string | null) => void;
  onCreate: (name: string) => Promise<void>;
  disabled: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const selected = value ? options.find(option => option.id === value)?.name ?? selectedLabel ?? `${label} unavailable` : emptyLabel;
  const create = async () => {
    if (disabled || running.current || !name.trim()) return;
    running.current = true; setSaving(true); setError(null);
    try { await onCreate(name.trim()); setOpen(false); setCreating(false); setName(""); setQuery(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `Couldn't create ${label.toLowerCase()}.`); }
    finally { running.current = false; setSaving(false); }
  };
  return <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Popover open={open} onOpenChange={next => { if (saving) return; setOpen(next); if (!next) { setCreating(false); setError(null); setQuery(""); } }}>
      <PopoverTrigger asChild><Button id={id} type="button" variant="outline" disabled={disabled} className="h-11 w-full min-w-0 justify-between px-3 font-normal" aria-label={`${label}: ${selected}`}><span className="truncate">{selected}</span><ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden /></Button></PopoverTrigger>
      <PopoverContent className={popoverClass} collisionPadding={16} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        {creating ? <div className="space-y-3 p-3">
          <Label htmlFor={`${id}-new`}>New {label.toLowerCase()}</Label>
          <Input id={`${id}-new`} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} autoFocus value={name} disabled={disabled} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} placeholder={`${label} name`} className="h-11" />
          {error && <p id={`${id}-error`} role="alert" className="break-words text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" className="h-11 px-3" disabled={saving} onClick={() => { setCreating(false); setError(null); }}>Back</Button><Button type="button" className="h-11 px-3" disabled={disabled || !name.trim()} onClick={() => void create()}>{saving ? "Creating…" : "Create"}</Button></div>
        </div> : <Command>
          <CommandInput aria-label={`Search categories`} placeholder={`Find a ${label.toLowerCase()}…`} value={query} onValueChange={setQuery} disabled={disabled} />
          <CommandList className="max-h-[min(240px,40dvh)]">
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {[{ id: "", name: emptyLabel }, ...options].map(option => <CommandItem key={option.id} value={option.id || "none"} keywords={[option.name]} disabled={disabled} className="min-h-11" onSelect={() => { onChange(option.id || null); setOpen(false); setQuery(""); }}><span className="min-w-0 flex-1 break-words">{option.name}</span>{(value ?? "") === option.id && <Check className="size-4 shrink-0" aria-hidden />}</CommandItem>)}
            </CommandGroup>
          </CommandList>
          <div className="border-t p-1"><Button type="button" variant="ghost" disabled={disabled} className="h-11 w-full justify-start px-2" onClick={() => { setName(query.trim()); setCreating(true); }}><Plus className="size-4" aria-hidden />New {label.toLowerCase()}</Button></div>
        </Command>}
      </PopoverContent>
    </Popover>
  </div>;
}

export function EditorTagsField({ tags, onChange, data, onCreate, disabled }: {
  tags: string[];
  onChange: (tags: string[]) => void;
  data: OrganizationResponse;
  onCreate: (name: string) => Promise<void>;
  disabled: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const atLimit = tags.length >= 10;
  const name = query.trim();
  const canCreate = !!name && ![...tags, ...data.tags.map(tag => tag.name)].some(tag => tag.toLowerCase() === name.toLowerCase());
  const create = async () => {
    if (disabled || atLimit || running.current || !canCreate) return;
    running.current = true; setSaving(true); setError(null);
    try { await onCreate(name); setQuery(""); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't create tag."); }
    finally { running.current = false; setSaving(false); }
  };
  return <div className="space-y-2">
    <div className="flex items-center justify-between"><Label htmlFor={id}>Tags</Label><span className="text-xs tabular-nums text-muted-foreground">{tags.length}/10</span></div>
    {tags.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-3">{tags.map(tag => <span key={tag} className="inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary pl-2.5 text-xs text-secondary-foreground"><span className="min-w-0 truncate" title={tag}>{tag}</span><Button type="button" variant="ghost" size="icon-sm" className="relative size-8 shrink-0 touch-manipulation before:absolute before:inset-0 [@media(pointer:coarse)]:before:-inset-1.5" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(value => value !== tag))}><X className="size-3.5" aria-hidden /></Button></span>)}</div>}
    <Popover open={open} onOpenChange={next => { if (saving) return; setOpen(next); if (!next) { setQuery(""); setError(null); } }}>
      <PopoverTrigger asChild><Button id={id} type="button" variant="outline" disabled={disabled || atLimit} className="h-11 w-full justify-start font-normal text-muted-foreground"><Plus className="size-4" aria-hidden />{atLimit ? "Tag limit reached" : "Add tags"}</Button></PopoverTrigger>
      <PopoverContent className={popoverClass} collisionPadding={16} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        <Command>
          <CommandInput aria-label="Search or create tags" placeholder="Find or create a tag…" value={query} onValueChange={setQuery} disabled={disabled || saving} />
          <CommandList className="max-h-[min(240px,40dvh)]">
            <CommandEmpty>No matching tags.</CommandEmpty>
            <CommandGroup>{data.tags.filter(tag => !tags.includes(tag.name)).map(tag => <CommandItem key={tag.id} value={tag.name} className="min-h-11 break-words" disabled={disabled || atLimit || saving} onSelect={() => { onChange([...tags, tag.name]); setQuery(""); setOpen(false); }}><Plus className="size-4" aria-hidden /><span className="min-w-0 break-words">{tag.name}</span></CommandItem>)}</CommandGroup>
          </CommandList>
          {canCreate && <div className="border-t p-1"><Button type="button" variant="ghost" disabled={disabled || atLimit || saving} className="h-11 w-full min-w-0 justify-start px-2" onClick={() => void create()}><Plus className="size-4" aria-hidden /><span className="truncate">{saving ? "Creating…" : `Create “${name}”`}</span></Button></div>}
        </Command>
        {error && <p role="alert" className="break-words px-3 pb-3 text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
    {tags.length > 10 && <p className="text-xs text-muted-foreground">Existing tags are preserved. Remove tags to get below ten before adding more.</p>}
  </div>;
}

/** Membership changes are explicit; toggling off/on retains the draft's read status. */
