"use client";

import { useMemo } from "react";
import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkX, Loader2 } from "lucide-react";
import {
  BookmarkCard,
  BookmarkCompactRow,
  BookmarkListItem,
  type BookmarkSelection,
} from "@bookmark-ai/ui/components/bookmark-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { groupBookmarksByDate } from "@/lib/date-groups";
import type { SelectionState } from "@/hooks/use-selection";
import { FirstRunPanel } from "./first-run-panel";
import type { LibraryView } from "./view-toggle";

export interface BookmarkGridProps {
  bookmarks: Bookmark[] | null;
  view: LibraryView;
  loading: boolean;
  error: string | null;
  emptyHint: string;
  onDelete: (id: string) => void;
  /**
   * Group into relative date buckets (Today / Yesterday / …). Turned off while
   * searching or when a date-range filter is applied.
   */
  grouped?: boolean;
  /**
   * The account has no bookmarks AT ALL (not merely none matching a filter or
   * search) — the empty grid is a new user's first screen, so it teaches instead
   * of shrugging. The caller owns the distinction; see LibraryPage.
   */
  firstRun?: boolean;
  /** Opens the add-bookmark dialog — the quiet path out of the first-run panel. */
  onAdd?: () => void;
  /**
   * A SAME-filter refetch is in flight (post-save/delete revalidate) and the
   * list on screen is still the right one — dim it plus a spinner rather than
   * throwing away content that's about to reappear identical. Ignored once
   * there's nothing stale to show (the skeleton path above wins).
   */
  dimmed?: boolean;
  /**
   * The load in flight is for a DIFFERENT filter set than what's on screen (a
   * facet click), so the stale list is worthless — skeleton it. This is the
   * instant "something is happening" response; dimming a list the user just
   * navigated away from read as a frozen screen. See useBookmarks.freshFilter.
   */
  freshLoad?: boolean;
  /**
   * How many placeholder items the skeleton should draw. The caller knows the
   * clicked facet's count from /api/meta, so a 3-bookmark category doesn't flash
   * 8 skeletons and then collapse. Clamped and defaulted per layout below.
   */
  skeletonCount?: number;
  /**
   * Bulk selection for this list, or omitted/null to render without any
   * selection affordance — which is what search results do (the bar is
   * page-scoped and a search's result set isn't a page the user can act on
   * safely). See hooks/use-selection.ts.
   */
  selection?: SelectionState | null;
}

/** The bookmark collection in one of three layouts, optionally grouped by date. */
export function BookmarkGrid({
  bookmarks,
  view,
  loading,
  error,
  emptyHint,
  onDelete,
  grouped,
  firstRun,
  onAdd,
  dimmed,
  freshLoad,
  skeletonCount,
  selection,
}: BookmarkGridProps) {
  // Shift-click ranges need the order the rows are ACTUALLY rendered in, which
  // is this flat list even when it's drawn in date groups.
  const order = useMemo(() => (bookmarks ?? []).map((b) => b.id), [bookmarks]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-medium">Could not load your bookmarks</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {error}. Check that you&rsquo;re signed in, then try again.
        </p>
      </div>
    );
  }

  // Skeleton whenever there's nothing worth showing: either a fetch is in flight
  // and we have nothing fresh (useSearch keeps the *previous* response during the
  // debounce + embed round-trip, and the first search inherits an empty result
  // list — guarding on `!bookmarks` alone flashed "No bookmarks here" for 1-3s
  // mid-search), or the list belongs to a filter the user just left.
  if (freshLoad || (loading && (!bookmarks || bookmarks.length === 0))) {
    return <LoadingSkeleton view={view} count={skeletonCount} />;
  }

  if (!bookmarks || bookmarks.length === 0) {
    // Nothing saved ever → onboard. Nothing matching a filter/search → the
    // quiet one-liner; a full-page pitch would be shouting at someone who
    // already knows how this works.
    if (firstRun) return <FirstRunPanel onAdd={onAdd} />;
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <BookmarkX className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="font-medium">No bookmarks here</p>
        <p className="max-w-sm text-sm text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  // A same-filter refetch is in flight over content that's still current: dim +
  // freeze it instead of flashing a skeleton, and hang a spinner over it so the
  // frozen grid never reads as a dead screen. The rail is sticky and zero-height
  // — visible wherever the user has scrolled, without shifting the list below it.
  // The spinner sits in its own chip, nudged down off the first group header's
  // baseline: unstyled and flush at the top it collided with "Today".
  const staleWrap = (node: React.ReactNode) =>
    dimmed ? (
      <div aria-busy className="relative">
        <div className="pointer-events-none sticky top-3 z-10 flex h-0 justify-center">
          <span className="flex size-8 -translate-y-1 items-center justify-center rounded-full border bg-background/95 shadow-sm backdrop-blur">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          </span>
        </div>
        <div className="pointer-events-none opacity-60 transition-opacity">{node}</div>
      </div>
    ) : (
      node
    );

  if (grouped) {
    const groups = groupBookmarksByDate(bookmarks);
    return staleWrap(
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold tracking-tight">{g.label}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">{g.items.length}</span>
            </div>
            <ItemLayout
              items={g.items}
              view={view}
              onDelete={onDelete}
              selection={selection}
              order={order}
            />
          </section>
        ))}
      </div>,
    );
  }

  return staleWrap(
    <ItemLayout
      items={bookmarks}
      view={view}
      onDelete={onDelete}
      selection={selection}
      order={order}
    />,
  );
}

/** Renders a set of bookmarks in the chosen layout — shared by flat + grouped modes. */
function ItemLayout({
  items,
  view,
  onDelete,
  selection,
  order,
}: {
  items: Bookmark[];
  view: LibraryView;
  onDelete: (id: string) => void;
  selection?: SelectionState | null;
  /** Flattened id order across ALL groups, for shift-click ranges. */
  order: readonly string[];
}) {
  // `undefined` (not a no-op object) when selection is off, so the shared card
  // components render their original markup with no checkbox slot at all.
  const selectionFor = (b: Bookmark): BookmarkSelection | undefined =>
    selection
      ? {
          selected: selection.has(b.id),
          pinned: selection.active,
          control: (
            <Checkbox
              checked={selection.has(b.id)}
              aria-label={`Select ${b.title}`}
              // onClick rather than onCheckedChange: the modifier keys only
              // exist on the mouse event, and shift-click range select needs
              // them. Radix keeps the box controlled off `checked`, so nothing
              // toggles behind our back.
              onClick={(e) => {
                e.stopPropagation();
                selection.toggle(b.id, { shiftKey: e.shiftKey, order });
              }}
            />
          ),
        }
      : undefined;

  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {items.map((b) => (
          <BookmarkListItem
            key={b.id}
            bookmark={b}
            onDelete={onDelete}
            selection={selectionFor(b)}
          />
        ))}
      </div>
    );
  }

  if (view === "compact") {
    return (
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {items.map((b) => (
          <BookmarkCompactRow
            key={b.id}
            bookmark={b}
            onDelete={onDelete}
            selection={selectionFor(b)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map((b) => (
        <BookmarkCard key={b.id} bookmark={b} onDelete={onDelete} selection={selectionFor(b)} />
      ))}
    </div>
  );
}

/** Per-layout placeholder counts when the caller doesn't know the real one. */
const SKELETON_DEFAULTS: Record<LibraryView, number> = { grid: 8, list: 6, compact: 10 };

function LoadingSkeleton({ view, count }: { view: LibraryView; count?: number }) {
  // Never zero (an empty skeleton is indistinguishable from a broken screen) and
  // never more than the default — a 400-bookmark facet doesn't need 400 shapes.
  const n = Math.min(Math.max(count ?? SKELETON_DEFAULTS[view], 1), SKELETON_DEFAULTS[view]);
  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: n }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (view === "compact") {
    return (
      <div className="divide-y overflow-hidden rounded-xl border">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="px-3 py-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[1.91/1] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
