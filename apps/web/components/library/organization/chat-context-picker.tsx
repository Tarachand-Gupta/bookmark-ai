"use client";

import { useEffect, useState } from "react";
import type { Bookmark, ChatContext } from "@bookmark-ai/types";
import { listBookmarks, searchBookmarks } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ChatContextPicker({
  open,
  onOpenChange,
  onSelect,
  onReturnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (context: ChatContext) => void;
  onReturnFocus?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Bookmark[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setIds([]);
      setQuery("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const request = query.trim()
        ? searchBookmarks(query, "text", controller.signal).then((result) =>
            result.results.map((row) => row.bookmark),
          )
        : listBookmarks({}, { limit: 100, offset: 0 }, controller.signal).then(
            (result) => result.bookmarks,
          );
      void request
        .then((value) => {
          if (!controller.signal.aborted) setRows(value);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden" onCloseAutoFocus={event => { if (onReturnFocus) { event.preventDefault(); onReturnFocus(); } }}>
        <DialogHeader>
          <DialogTitle>Choose bookmarks</DialogTitle>
          <DialogDescription>
            Add saved bookmarks to guide your answer. Your full library stays available.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search saved bookmarks"
          aria-label="Search saved bookmarks"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="min-h-0 max-h-80 space-y-1 overflow-auto overscroll-contain">
          {loading ? (
            <p role="status">Loading…</p>
          ) : (
            <>
              {!rows.length && (
                <p className="py-8 text-sm text-muted-foreground">
                  No saved bookmarks match. Try a different search or save a link first.
                </p>
              )}
              {rows.map((row) => (
                <label
                  key={row.id}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted focus-within:outline focus-within:outline-2 focus-within:outline-ring"
                >
                  <input
                    type="checkbox"
                    checked={ids.includes(row.id)}
                    disabled={!ids.includes(row.id) && ids.length >= 1000}
                    onChange={() =>
                      setIds((previous) =>
                        previous.includes(row.id)
                          ? previous.filter((id) => id !== row.id)
                          : [...previous, row.id],
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.url}</span>
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
        <DialogFooter className="shrink-0 items-center">
          <span role="status" className="mr-auto text-sm">{ids.length} selected · up to 1,000</span>
          <Button
            className="min-h-11"
            disabled={!ids.length}
            onClick={() => {
              onSelect({ type: "bookmarks", bookmarkIds: ids });
              setIds([]);
            }}
          >
            Attach bookmarks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
