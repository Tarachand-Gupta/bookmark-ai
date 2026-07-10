"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SearchMode } from "@bookmark-ai/types";
import {
  CalendarDays,
  Chrome,
  Compass,
  Flame,
  Folder,
  Globe,
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { deleteBookmark, deleteSession, type LibraryFilters } from "@/lib/api";
import {
  useBookmarks,
  useHealth,
  useMeta,
  useRefresh,
  useSearch,
  useSessions,
} from "@/hooks/use-library";
import { AiChat } from "./ai-chat";
import { AppSidebar } from "./app-sidebar";
import { BookmarkGrid } from "./bookmark-grid";
import { LibraryHeader, type HeaderCrumb } from "./library-header";
import { TagChips } from "./tag-chips";
import { ViewToggle, type LibraryView } from "./view-toggle";
import { DateRangeFilter } from "./date-range-filter";
import { SessionCard, SessionsView } from "./sessions-view";
import { AddBookmarkDialog } from "./add-bookmark-dialog";

const VIEW_STORAGE_KEY = "bookmark-ai:view";

const FILTER_KEYS = ["category", "browser", "device", "day", "tag", "from", "to"] as const;

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
    (next: LibraryFilters, opts?: { clearSearch?: boolean }) => {
      const params = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        if (next[key]) params.set(key, next[key]!);
      }
      // Search state rides along so a facet click doesn't wipe it from the URL —
      // except when the caller is deliberately leaving search (e.g. chat "jump to library").
      if (!opts?.clearSearch) {
        const q = searchParams.get("q");
        const m = searchParams.get("mode");
        if (q) params.set("q", q);
        if (m) params.set("mode", m);
      }
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

  // Display preference, not shareable state → localStorage, not the URL.
  // Read in an effect so the server-rendered markup (grid) hydrates cleanly.
  const [view, setView] = useState<LibraryView>("grid");
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "grid" || saved === "list" || saved === "compact") setView(saved);
  }, []);
  const changeView = useCallback((next: LibraryView) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }, []);

  // Mirror search state into the URL so refresh/share keeps it, like facets.
  // replace (not push) — keystrokes must not pollute history.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      const trimmed = query.trim();
      if (trimmed) {
        params.set("q", trimmed);
        params.delete("section"); // starting a search leaves the Sessions view
      } else {
        params.delete("q");
      }
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
  // The grid always shows live full-text results; "ai" mode opens the chat panel.
  const search = useSearch(query, "text", refreshKey);
  const sessions = useSessions(refreshKey);

  // Saved sessions are a distinct section, keyed off ?section=sessions so the
  // extension can deep-link into it right after saving a session.
  const sessionsActive = searchParams.get("section") === "sessions";

  const searching = query.trim().length > 0;
  const bookmarks = searching
    ? (search.data?.results.map((r) => r.bookmark) ?? null)
    : list.bookmarks;

  // Group the content by relative date unless searching or a specific date
  // filter (range or single day) is active — then show a flat, filtered list.
  const grouped = !searching && !filters.from && !filters.to && !filters.day;

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

  const showSessions = useCallback(() => {
    setQuery("");
    setMode("text");
    router.push(`${pathname}?section=sessions`, { scroll: false });
  }, [router, pathname]);

  const handleSessionDelete = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        await deleteSession(id);
      } catch (err) {
        setActionError((err as Error).message);
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  // Breadcrumb: root view + the active facet; search presents in the content area.
  const crumb = sessionsActive ? null : headerCrumb(filters);
  const title = sessionsActive ? "Sessions" : "All bookmarks";
  const aiActive = mode === "ai";

  // Leaving the chat must also drop the query, or the grid lands on stale
  // (possibly empty) text results instead of the library.
  const closeChat = useCallback(() => {
    setMode("text");
    setQuery("");
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar
        meta={meta.data}
        aiEnabled={health.data ? health.data.ai : health.error ? false : null}
        filters={filters}
        onFilterChange={setFilters}
        sessionsActive={sessionsActive}
        sessionCount={sessions.data?.sessions.length ?? null}
        onShowSessions={showSessions}
        onAdd={() => setAddOpen(true)}
      />
      <SidebarInset>
        <LibraryHeader
          title={title}
          crumb={crumb}
          onRootClick={() => setFilters({})}
          query={query}
          aiActive={aiActive}
          onQueryChange={(q) => {
            setQuery(q);
            setMode("text"); // typing always returns to live full-text search
          }}
          onAskAi={() => setMode("ai")}
        />
        <main className="flex-1 p-4">
          {/* Width-capped and centered so content isn't stretched thin on
              widescreen/desktop; full-bleed below the cap on smaller screens. */}
          <div className="mx-auto w-full max-w-7xl">
            {aiActive ? (
              <AiChat
                initialQuery={query}
                onClose={closeChat}
                onFilter={(next) => {
                  closeChat();
                  setFilters(next, { clearSearch: true });
                }}
              />
            ) : sessionsActive ? (
              <>
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight">Saved sessions</h2>
                </div>
                <SessionsView
                  sessions={sessions.data?.sessions ?? null}
                  loading={sessions.loading}
                  error={sessions.error}
                  onDelete={handleSessionDelete}
                />
              </>
            ) : (
              <>
                <div className="mb-4 flex items-start gap-3">
                  {searching ? (
                    <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                      Results for “{query.trim()}”
                    </h2>
                  ) : (
                    <TagChips
                      className="flex-1"
                      tags={meta.data?.tags}
                      active={filters.tag}
                      onPick={(tag) => setFilters(tag ? { tag } : {})}
                    />
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {!searching && (
                      <DateRangeFilter
                        from={filters.from}
                        to={filters.to}
                        onChange={({ from, to }) => setFilters({ ...filters, from, to })}
                      />
                    )}
                    <ViewToggle view={view} onChange={changeView} />
                  </div>
                </div>
                {!searching && filters.tag && (
                  <div className="mb-4 flex items-baseline gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">#{filters.tag}</h2>
                    {list.total != null && (
                      <span className="text-sm text-muted-foreground">
                        {list.total} bookmark{list.total === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                )}
                {actionError && (
                  <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    Delete failed: {actionError}
                  </p>
                )}
                {/* Matching saved sessions surface above bookmark results,
                    under their own labeled heading so the two kinds read apart. */}
                {searching && (search.data?.sessionResults?.length ?? 0) > 0 && (
                  <section className="mb-6">
                    <div className="mb-3 flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold tracking-tight">Sessions</h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {search.data!.sessionResults!.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {search.data!.sessionResults!.map(({ session }) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          onDelete={handleSessionDelete}
                          highlight={query}
                        />
                      ))}
                    </div>
                    <div className="mt-6 mb-3 flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold tracking-tight">Bookmarks</h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {search.data?.results.length ?? 0}
                      </span>
                    </div>
                  </section>
                )}
                <BookmarkGrid
                  bookmarks={bookmarks}
                  view={view}
                  grouped={grouped}
                  loading={searching ? search.loading : list.loading}
                  error={searching ? search.error : list.error}
                  emptyHint={
                    searching
                      ? "No matches. Try different words, or Ask AI for an answer."
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
              </>
            )}
          </div>
        </main>
      </SidebarInset>
      <AddBookmarkDialog open={addOpen} onOpenChange={setAddOpen} onSaved={refresh} />
    </SidebarProvider>
  );
}

const CRUMB_BROWSER_ICONS: Record<string, React.ElementType> = {
  chrome: Chrome,
  firefox: Flame,
  safari: Compass,
  edge: Globe,
  arc: Globe,
  other: Globe,
};

const CRUMB_DEVICE_ICONS: Record<string, React.ElementType> = {
  desktop: Monitor,
  laptop: Laptop,
  mobile: Smartphone,
  tablet: Tablet,
  other: Monitor,
};

// Tags are deliberately absent: a tag is a filter presented in the content area
// (chip rail + "#tag" heading), so the top bar keeps naming the selected view.
function headerCrumb(filters: LibraryFilters): HeaderCrumb | null {
  if (filters.category) return { label: filters.category, Icon: Folder };
  if (filters.browser)
    return { label: capitalize(filters.browser), Icon: CRUMB_BROWSER_ICONS[filters.browser] ?? Globe };
  if (filters.device)
    return { label: capitalize(filters.device), Icon: CRUMB_DEVICE_ICONS[filters.device] ?? Monitor };
  if (filters.day) return { label: filters.day, Icon: CalendarDays };
  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
