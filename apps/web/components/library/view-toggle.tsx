"use client";

import { LayoutGrid, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookmarkView } from "@/lib/bookmark-view";
export type LibraryView = BookmarkView;

const VIEWS = [
  { key: "grid", label: "Grid view", Icon: LayoutGrid },
  { key: "table", label: "Table view", Icon: Table2 },
] as const;

/** Desktop presentation only. Phones keep their original cards. */
export function ViewToggle({ view, onChange, className }: {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
  className?: string;
}) {
  return <div role="group" aria-label="Bookmark view" className={cn("hidden shrink-0 items-center gap-0.5 rounded-lg border bg-background p-0.5 md:flex", className)}>
    {VIEWS.map(({ key, label, Icon }) => <button key={key} type="button" aria-pressed={view === key} aria-label={label} title={label} onClick={() => onChange(key)} className={cn("flex size-8 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:size-11", view === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="size-4" aria-hidden /></button>)}
  </div>;
}
