"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetaResponse } from "@bookmark-ai/types";
import { ChevronDown, ChevronUp, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TagChipsProps {
  tags: MetaResponse["tags"] | undefined;
  active: string | undefined;
  onPick: (tag: string | undefined) => void;
  /** Controlled expansion. The library page owns it so the wrapper can claim a
   * full-width row of its own while the cloud is open (see library-page.tsx);
   * omit both props and the toggle manages its own state. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
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
 * horizontally-scrollable line, and an expand toggle at the end that
 * reveals the full wrapped list. Desktop only — at <md the library page hides
 * this and offers the Tags drawer instead (see mobile-filter-bar.tsx).
 *
 * Expanded, the wrapped cloud renders as a SECOND row beneath the label/toggle
 * row rather than growing the rail in place: the rail shares its flex line with
 * the Date + view controls, and a cloud that wraps there collides with them. The
 * page pairs this with a full-width wrapper row for the expanded state.
 */
export function TagChips({
  tags,
  active,
  onPick,
  expanded: expandedProp,
  onExpandedChange,
  className,
}: TagChipsProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const expanded = expandedProp ?? uncontrolled;
  const toggle = () => {
    const next = !expanded;
    setUncontrolled(next);
    onExpandedChange?.(next);
  };
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
    if (!el || expanded) {
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
  }, [expanded, tags, measure]);

  if (!tags || tags.length === 0) return null;

  // One chip list, rendered into whichever container the current state uses —
  // the scrolling rail or the wrapped cloud. Building it once keeps the two
  // presentations from drifting on styling or click semantics.
  const chips = tags.map((t) => {
    const isActive = t.name === active;
    return (
      <button
        key={t.name}
        type="button"
        aria-pressed={isActive}
        onClick={() => onPick(isActive ? undefined : t.name)}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
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
      className={cn("flex min-w-0 flex-col gap-2", className)}
      role="group"
      aria-label="Filter by tag"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Tag className="size-3.5" aria-hidden />
          Tags
        </span>
        {!expanded && (
          <div
            ref={railRef}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5",
              // contain:inline-size zeroes the row's intrinsic width — without it
              // the summed chip width propagates up and stretches the whole page
              // sideways (overflow-x-auto does not reduce intrinsic size).
              "-mb-2 overflow-x-auto pb-2 [contain:inline-size] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
              edgeMask(edges),
            )}
          >
            {chips}
          </div>
        )}
        {/* Stays on the header row in both states, so collapsing is always one
            click from where expanding happened — never at the end of the cloud. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse tags" : "Show all tags"}
          title={expanded ? "Collapse tags" : "Show all tags"}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp className="size-4" aria-hidden />
          ) : (
            <ChevronDown className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {expanded && <div className="flex w-full flex-wrap items-center gap-1.5">{chips}</div>}
    </div>
  );
}
