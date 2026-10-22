"use client";

import { useRef, useState, type ReactElement } from "react";
import type { MetaResponse } from "@bookmark-ai/types";
import { Check, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** One floating picker for the desktop rail and the mobile Tags button. */
export function TagPicker({ tags, active, onPick, children, align = "end" }: {
  tags: MetaResponse["tags"];
  active?: string;
  onPick: (tag: string | undefined) => void;
  children: ReactElement;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const firstChoice = useRef<HTMLButtonElement>(null);
  const matches = tags.filter(tag => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (tag: string | undefined) => {
    onPick(tag);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        collisionPadding={12}
        aria-label="Choose a tag"
        // Opening a list on a phone should not immediately summon the keyboard.
        onOpenAutoFocus={event => { event.preventDefault(); firstChoice.current?.focus(); }}
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw_-_1.5rem)] flex-col gap-3 overflow-hidden rounded-xl p-3"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-1">
          <span className="text-sm font-semibold">Tags</span>
          <span className="text-xs text-muted-foreground">{tags.length} tags</span>
        </div>
        <Input aria-label="Search tags" placeholder="Search tags…" value={query} onChange={event => setQuery(event.target.value)} className="shrink-0" />
        <div className="min-h-0 overflow-y-auto overscroll-contain" role="group" aria-label="Available tags">
          <button ref={firstChoice} type="button" aria-pressed={!active} onClick={() => choose(undefined)} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted md:min-h-9">
            <Tag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">All tags</span>
            {!active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
          </button>
          {matches.map(tag => (
            <button key={tag.name} type="button" aria-pressed={active === tag.name} onClick={() => choose(active === tag.name ? undefined : tag.name)} className={cn("flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm md:min-h-9", active === tag.name ? "bg-primary/10 text-foreground" : "hover:bg-muted")}>
              <Tag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 break-words">{tag.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tag.count}</span>
              {active === tag.name && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
            </button>
          ))}
          {matches.length === 0 && <p className="px-2 py-4 text-sm text-muted-foreground">No matching tags.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
