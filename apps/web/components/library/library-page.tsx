"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SearchMode } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { deleteBookmark, type LibraryFilters } from "@/lib/api";
import { useBookmarks, useHealth, useMeta, useRefresh, useSearch } from "@/hooks/use-library";
import { AppSidebar } from "./app-sidebar";
import { BookmarkGrid } from "./bookmark-grid";
import { LibraryHeader } from "./library-header";
import { TagChips } from "./tag-chips";
import { AddBookmarkDialog } from "./add-bookmark-dialog";

const FILTER_KEYS = ["category", "browser", "device", "day", "tag"] as const;

/**
 * The whole library view. Facet filters live in the URL (shareable,
 * back-button friendly); search is local state layered on top.
 */
export function LibraryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<LibraryFilters>(() => {
    const out: LibraryFilters = {};
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) out[key] = value;
    }
    return out;
  }, [searchParams]);

  const setFilters = useCallback(
    (next: LibraryFilters) => {
      const params = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        if (next[key]) params.set(key, next[key]!);
      }
      // Search state rides along so a facet click doesn't wipe it from the URL.
      const q = searchParams.get("q");
      const m = searchParams.get("mode");
      if (q) params.set("q", q);
      if (m) params.set("mode", m);
      // push (not replace) so each facet change is a history entry — back button
      // walks the filter states, as docs/TESTING.md promises.
      router.push(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [mode, setMode] = useState<SearchMode>(() =>
    searchParams.get("mode") === "ai" ? "ai" : "text",
  );
  const [addOpen, setAddOpen] = useState(false);

  // Mirror search state into the URL so refresh/share keeps it, like facets.
  // replace (not push) — keystrokes must not pollute history.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      const trimmed = query.trim();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      if (mode === "ai") params.set("mode", mode);
      else params.delete("mode");
      const next = params.size ? `${pathname}?${params}` : pathname;
      const current = searchParams.size ? `${pathname}?${searchParams}` : pathname;
      if (next !== current) router.replace(next, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, mode, pathname, router, searchParams]);

  const [refreshKey, refresh] = useRefresh();
  const meta = useMeta(refreshKey);
  const health = useHealth(refreshKey);
  const list = useBookmarks(filters, refreshKey);
  const search = useSearch(query, mode, refreshKey);

  const searching = query.trim().length > 0;
  const bookmarks = searching
    ? (search.data?.results.map((r) => r.bookmark) ?? null)
    : list.bookmarks;

  const [actionError, setActionError] = useState<string | null>(null);
  const handleDelete = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await deleteBookmark(id);
      } catch (err) {
        setActionError((err as Error).message);
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  // The title always names the selected view; search presents in the content area.
  const title = viewTitle(filters);
  const aiActive = mode === "ai";

  return (
    <SidebarProvider>
      <AppSidebar
        meta={meta.data}
        aiEnabled={health.data ? health.data.ai : health.error ? false : null}
        filters={filters}
        onFilterChange={setFilters}
      />
      <SidebarInset>
        <LibraryHeader
          title={title}
          query={query}
          aiActive={aiActive}
          onQueryChange={(q) => {
            setQuery(q);
            setMode("text"); // typing always returns to live full-text search
          }}
          onAskAi={() => setMode("ai")}
          onAdd={() => setAddOpen(true)}
        />
        <main className="flex-1 p-4">
          {searching && (
            <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {aiActive ? "AI results" : "Results"} for “{query.trim()}”
              </h2>
              {aiActive && search.data?.fallback && (
                <span className="text-xs text-muted-foreground">
                  AI unavailable — showing text results
                </span>
              )}
            </div>
          )}
          {!searching && (
            <TagChips
              tags={meta.data?.tags}
              active={filters.tag}
              onPick={(tag) => setFilters(tag ? { tag } : {})}
            />
          )}
          {actionError && (
            <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Delete failed: {actionError}
            </p>
          )}
          <BookmarkGrid
            bookmarks={bookmarks}
            loading={searching ? search.loading : list.loading}
            error={searching ? search.error : list.error}
            emptyHint={
              searching
                ? mode === "ai"
                  ? "No semantic matches. AI search needs embedded bookmarks — save a few first."
                  : "No matches. Try different words, or Ask AI for a semantic search."
                : "Save a page with the browser extension, or add a URL with the button above."
            }
            onDelete={handleDelete}
          />
          {!searching && list.hasMore && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">
                Showing {list.bookmarks?.length ?? 0} of {list.total}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={list.loadMore}
                disabled={list.loadingMore}
              >
                {list.loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </main>
      </SidebarInset>
      <AddBookmarkDialog open={addOpen} onOpenChange={setAddOpen} onSaved={refresh} />
    </SidebarProvider>
  );
}

function viewTitle(filters: LibraryFilters): string {
  if (filters.category) return filters.category;
  if (filters.browser) return `Saved from ${capitalize(filters.browser)}`;
  if (filters.device) return `Saved on ${capitalize(filters.device)}`;
  if (filters.day) return `Saved ${filters.day}`;
  if (filters.tag) return `#${filters.tag}`;
  return "All bookmarks";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
