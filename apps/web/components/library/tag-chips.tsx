"use client";

import type { MetaResponse } from "@bookmark-ai/types";
import { cn } from "@/lib/utils";

export interface TagChipsProps {
  tags: MetaResponse["tags"] | undefined;
  active: string | undefined;
  onPick: (tag: string | undefined) => void;
}

/** Dribbble-style tag rail above the grid: chips with counts, one active at a time. */
export function TagChips({ tags, active, onPick }: TagChipsProps) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
      {tags.map((t) => {
        const isActive = t.name === active;
        return (
          <button
            key={t.name}
            type="button"
            aria-pressed={isActive}
            onClick={() => onPick(isActive ? undefined : t.name)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              isActive
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.name}
            <span
              className={cn(
                "tabular-nums",
                isActive ? "text-primary-foreground/70" : "text-muted-foreground/60",
              )}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
