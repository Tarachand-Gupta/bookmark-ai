"use client";

import type { SearchMode } from "@bookmark-ai/types";
import { Plus, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export interface LibraryHeaderProps {
  title: string;
  query: string;
  mode: SearchMode;
  onQueryChange: (q: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onAdd: () => void;
}

/** Sticky top bar: sidebar trigger, active-view title, search, add. */
export function LibraryHeader({
  title,
  query,
  mode,
  onQueryChange,
  onModeChange,
  onAdd,
}: LibraryHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 hidden !h-4 sm:block" />
      <h1 className="mr-auto truncate text-sm font-medium sm:text-base">{title}</h1>

      <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
        <div className="relative flex-1 sm:w-72 sm:flex-none">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={mode === "ai" ? "Ask your bookmarks…" : "Search bookmarks…"}
            className="h-9 pl-8"
            aria-label="Search bookmarks"
          />
        </div>

        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Search mode">
          <SegButton active={mode === "text"} onClick={() => onModeChange("text")}>
            Text
          </SegButton>
          <SegButton active={mode === "ai"} onClick={() => onModeChange("ai")}>
            <Sparkles className="size-3.5" aria-hidden />
            AI
          </SegButton>
        </div>

        <Button size="sm" className="h-9" onClick={onAdd}>
          <Plus aria-hidden />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>
    </header>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1 px-2.5 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
