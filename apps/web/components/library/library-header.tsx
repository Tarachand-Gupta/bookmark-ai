"use client";

import { Plus, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export interface LibraryHeaderProps {
  title: string;
  query: string;
  /** True while the shown results came from an explicit "Ask AI". */
  aiActive: boolean;
  onQueryChange: (q: string) => void;
  onAskAi: () => void;
  onAdd: () => void;
}

/**
 * Sticky top bar: sidebar trigger, active-view title, search, add.
 * Typing searches full-text live; the in-box "Ask AI" affordance runs the
 * semantic search. The title always names the selected view — search state
 * is presented in the content area, never here.
 */
export function LibraryHeader({
  title,
  query,
  aiActive,
  onQueryChange,
  onAskAi,
  onAdd,
}: LibraryHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 hidden !h-4 sm:block" />
      <h1 className="mr-auto truncate text-sm font-medium sm:text-base">{title}</h1>

      <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
        <div className="relative flex-1 sm:w-80 sm:flex-none">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search bookmarks…"
            className="h-9 pl-8 pr-[4.75rem]"
            aria-label="Search bookmarks"
          />
          <button
            type="button"
            onClick={onAskAi}
            disabled={!query.trim()}
            aria-pressed={aiActive}
            aria-label="Ask AI"
            className={cn(
              "absolute right-1 top-1/2 inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
              aiActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              !query.trim() && "pointer-events-none opacity-40",
            )}
          >
            <Sparkles className="size-3.5" aria-hidden />
            Ask AI
          </button>
        </div>

        <Button size="sm" className="h-9" onClick={onAdd}>
          <Plus aria-hidden />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>
    </header>
  );
}
