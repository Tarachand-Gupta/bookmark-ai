"use client";

import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkX } from "lucide-react";
import {
  BookmarkCard,
  BookmarkCompactRow,
  BookmarkListItem,
} from "@bookmark-ai/ui/components/bookmark-card";
import { Skeleton } from "@/components/ui/skeleton";
import { groupBookmarksByDate } from "@/lib/date-groups";
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
}: BookmarkGridProps) {
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

  // While a fetch is in flight, show the skeleton whenever we have nothing
  // fresh to render. useSearch keeps the *previous* response during the debounce
  // + embed round-trip, and the first search inherits an empty result list — so
  // guarding on `!bookmarks` alone flashed "No bookmarks here" for 1-3s mid-search.
  if (loading && (!bookmarks || bookmarks.length === 0)) {
    return <LoadingSkeleton view={view} />;
  }

  if (!bookmarks || bookmarks.length === 0) {
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

  if (grouped) {
    const groups = groupBookmarksByDate(bookmarks);
    return (
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold tracking-tight">{g.label}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">{g.items.length}</span>
            </div>
            <ItemLayout items={g.items} view={view} onDelete={onDelete} />
          </section>
        ))}
      </div>
    );
  }

  return <ItemLayout items={bookmarks} view={view} onDelete={onDelete} />;
}

/** Renders a set of bookmarks in the chosen layout — shared by flat + grouped modes. */
function ItemLayout({
  items,
  view,
  onDelete,
}: {
  items: Bookmark[];
  view: LibraryView;
  onDelete: (id: string) => void;
}) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {items.map((b) => (
          <BookmarkListItem key={b.id} bookmark={b} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  if (view === "compact") {
    return (
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {items.map((b) => (
          <BookmarkCompactRow key={b.id} bookmark={b} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map((b) => (
        <BookmarkCard key={b.id} bookmark={b} onDelete={onDelete} />
      ))}
    </div>
  );
}

function LoadingSkeleton({ view }: { view: LibraryView }) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (view === "compact") {
    return (
      <div className="divide-y overflow-hidden rounded-xl border">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="px-3 py-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[1.91/1] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
