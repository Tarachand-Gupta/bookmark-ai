"use client";

import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkX } from "lucide-react";
import {
  BookmarkCard,
  BookmarkCompactRow,
  BookmarkListItem,
} from "@bookmark-ai/ui/components/bookmark-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryView } from "./view-toggle";

export interface BookmarkGridProps {
  bookmarks: Bookmark[] | null;
  view: LibraryView;
  loading: boolean;
  error: string | null;
  emptyHint: string;
  onDelete: (id: string) => void;
}

/** The bookmark collection in one of three layouts: card grid, list rows, compact lines. */
export function BookmarkGrid({
  bookmarks,
  view,
  loading,
  error,
  emptyHint,
  onDelete,
}: BookmarkGridProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-medium">Could not reach the Bookmark AI server</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {error}. Make sure the API is running (<code>pnpm --filter @bookmark-ai/server dev</code>).
        </p>
      </div>
    );
  }

  if (loading && !bookmarks) {
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

  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        {bookmarks.map((b) => (
          <BookmarkListItem key={b.id} bookmark={b} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  if (view === "compact") {
    return (
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {bookmarks.map((b) => (
          <BookmarkCompactRow key={b.id} bookmark={b} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {bookmarks.map((b) => (
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
