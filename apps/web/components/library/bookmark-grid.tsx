"use client";

import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkX } from "lucide-react";
import { BookmarkCard } from "@bookmark-ai/ui/components/bookmark-card";
import { Skeleton } from "@/components/ui/skeleton";

export interface BookmarkGridProps {
  bookmarks: Bookmark[] | null;
  loading: boolean;
  error: string | null;
  emptyHint: string;
  onDelete: (id: string) => void;
}

/** Responsive card grid: 1 column on phones up to 4 on wide screens. */
export function BookmarkGrid({ bookmarks, loading, error, emptyHint, onDelete }: BookmarkGridProps) {
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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {bookmarks.map((b) => (
        <BookmarkCard key={b.id} bookmark={b} onDelete={onDelete} />
      ))}
    </div>
  );
}
