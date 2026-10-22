"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetaResponse } from "@bookmark-ai/types";
import { ChevronDown, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagPicker } from "./tag-picker";

export interface TagChipsProps {
  tags: MetaResponse["tags"] | undefined;
  active: string | undefined;
  onPick: (tag: string | undefined) => void;
  className?: string;
}

/** Which edges of the collapsed rail have content scrolled past them. */
interface Edges {
  start: boolean;
  end: boolean;
}

/** Mask that fades whichever edge has more chips behind it. No overflow ⇒ no
 * mask at all, so a three-tag library isn't dimmed for nothing. */
function edgeMask({ start, end }: Edges): string | undefined {
  if (start && end) {
    return "[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]";
  }
  if (end) return "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]";
  if (start) return "[mask-image:linear-gradient(to_right,transparent,black_2rem)]";
  return undefined;
}

/**
 * Tag rail above the grid: a "Tags" label, chips with counts on one
 * horizontally-scrollable line, and a floating picker for the full list.
 * Mobile uses the same picker from its Tags button.
 */
export function TagChips({
  tags,
  active,
  onPick,
  className,
}: TagChipsProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  // The rail scrolls chips out of sight with no affordance saying so. Measure
  // rather than always fading: the mask must appear only when something is
  // actually cut off, and that changes with the tag list, the panel width, and
  // every scroll. 2px slack absorbs sub-pixel scroll positions.
  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 });
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) {
      setEdges({ start: false, end: false });
      return;
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [tags, measure]);

  if (!tags || tags.length === 0) return null;

  const chips = tags.map((t) => {
    const isActive = t.name === active;
    return (
      <button
        key={t.name}
        type="button"
        aria-pressed={isActive}
        onClick={() => onPick(isActive ? undefined : t.name)}
        className={cn(
          "cursor-pointer inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
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
  });

  return (
    <div
      className={cn("flex h-9 min-w-0 items-center gap-2", className)}
      role="group"
      aria-label="Filter by tag"
    >
      <span className="flex h-9 shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Tag className="size-4" aria-hidden />
        Tags
      </span>
      <div
        ref={railRef}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5",
          // Contain the intrinsic chip width so the scroll rail cannot stretch the page.
          "-mb-2 overflow-x-auto pb-2 [contain:inline-size] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
          edgeMask(edges),
        )}
      >
        {chips}
      </div>
      <TagPicker tags={tags} active={active} onPick={onPick}>
        <button
          type="button"
          aria-label="Show all tags"
          title="Show all tags"
          className="cursor-pointer flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </TagPicker>
    </div>
  );
}
