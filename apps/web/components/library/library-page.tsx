"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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
import {
  deleteBookmark,
  deleteSession,
  getSettings,
  updateSettings,
  type LibraryFilters,
} from "@/lib/api";
import {
  useBookmarks,
  useHealth,
  useMeta,
  useRefresh,
  useSearch,
  useSessions,
} from "@/hooks/use-library";
import { NoAccessNotice } from "@/components/no-access-notice";
import { AccountSetup } from "./account-setup";
import { AppSidebar } from "./app-sidebar";
import { BookmarkGrid } from "./bookmark-grid";
import { LibraryHeader, type HeaderCrumb } from "./library-header";
import { TagChips } from "./tag-chips";
import { ViewToggle, type LibraryView } from "./view-toggle";
import { DateRangeFilter } from "./date-range-filter";
import { SessionCard } from "./sessions-view";
import { SessionsPanel } from "./sessions-panel";
import { OngoingView } from "./ongoing-view";
import { SECTION_IDS, SettingsDialog, type SectionId } from "./settings-dialog";
import { AddBookmarkDialog } from "./add-bookmark-dialog";
import { OnboardingDialog } from "./onboarding-dialog";

const VIEW_STORAGE_KEY = "bookmark-ai:view";
/** First-run tour fast-path: set once this account has dismissed the tour (on
 * this browser). The server flag `settings.onboardedAt` is the authority — this
 * only avoids a flash/refetch on subsequent loads before settings resolve. */
const ONBOARDED_KEY = "bmk:onboarded";

const FILTER_KEYS = ["category", "browser", "device", "day", "tag", "from", "to"] as const;

/** URL flag that opens the Ask AI dock. The dock itself lives at the /app layout
 * level (see AppChatDock) — this page only reads/toggles the param for the
 * header button and preserves it across navigation. Keep in sync with the dock. */
const AI_PARAM = "ai";

/**
 * The whole library view. Facet filters live in the URL (shareable,
 * back-button friendly); search is local state layered on top.
 */
export function LibraryPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Every view switch here (section, facet, search mirror, settings-param
  // clearing) is pure URL state — nothing server-side changes, all data comes
  // from the client hooks below. router.push/replace would still trigger an RSC
  // round-trip on each click, which is exactly the 1-2s "frozen" feel. The
  // native History API updates the URL WITHOUT that round-trip and Next keeps
  // useSearchParams/usePathname in sync (and handles back/forward via popstate),
  // so the view swaps synchronously on click. See the single-page-app guide.
  const shallowPush = useCallback(
    (url: string) => {
      window.history.pushState(null, "", url);
    },
    [],
  );
  const shallowReplace = useCallback(
    (url: string) => {
      window.history.replaceState(null, "", url);
    },
    [],
  );

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
        if (q) params.set("q", q);
      }
      // The Ask AI dock is orthogonal panel state — keep it open across any facet
      // change so the conversation stays put beside the filtered library.
      if (searchParams.get(AI_PARAM) === "1") params.set(AI_PARAM, "1");
      // push (not replace) so each facet change is a history entry — back button
      // walks the filter states, as docs/TESTING.md promises. Shallow: pushState
      // keeps the URL in sync without an RSC round-trip (no scroll-to-top either,
      // which matches the previous { scroll: false }).
      shallowPush(params.size ? `${pathname}?${params}` : pathname);
    },
    [shallowPush, pathname, searchParams],
  );

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [addOpen, setAddOpen] = useState(false);
  // Settings modal is owned here (not in the sidebar) so the Ongoing empty state
  // can deep-link into Settings → Devices.
  const [settings, setSettings] = useState<{ open: boolean; section: SectionId }>({
    open: false,
    section: "ai",
  });
  const openSettings = useCallback((section: SectionId = "ai") => {
    setSettings({ open: true, section });
  }, []);

  // Deep link: /app?settings=<sectionId> opens Settings at that section (the
  // extension's gear links to ?settings=devices). An unknown value falls back to
  // the dialog's default section. A ref guards against re-yanking the user off a
  // section they navigated to inside the dialog when some OTHER param changes.
  const handledSettingsParam = useRef<string | null>(null);
  useEffect(() => {
    const param = searchParams.get("settings");
    if (!param) {
      handledSettingsParam.current = null;
      return;
    }
    if (param === handledSettingsParam.current) return;
    handledSettingsParam.current = param;
    openSettings(SECTION_IDS.includes(param as SectionId) ? (param as SectionId) : undefined);
  }, [searchParams, openSettings]);

  // Strip the ?settings param (preserving the rest) when the dialog closes, so
  // the deep-linked URL doesn't linger and re-open on the next param change.
  const clearSettingsParam = useCallback(() => {
    if (!searchParams.get("settings")) return;
    const params = new URLSearchParams(searchParams);
    params.delete("settings");
    // Pure URL cleanup — no server data changes, so replace shallowly.
    shallowReplace(params.size ? `${pathname}?${params}` : pathname);
  }, [shallowReplace, pathname, searchParams]);

  // First-run tour: open once per ACCOUNT, on any device. The server flag
  // (settings.onboardedAt) is the authority — a new account on a browser that
  // already toured still sees it, and the same account never re-sees it on a new
  // device. localStorage is only a fast-path so a returning user on THIS browser
  // doesn't get a flash before settings resolve. Read in an effect so the
  // server-rendered markup hydrates cleanly; the footer "Tour" item reopens it.
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(ONBOARDED_KEY)) return; // already toured on this browser
    let cancelled = false;
    getSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        if (settings.onboardedAt) {
          // Toured on another device — remember locally so we don't flash next load.
          localStorage.setItem(ONBOARDED_KEY, "1");
        } else {
          setOnboardingOpen(true);
        }
      })
      // Settings unavailable (offline / still provisioning) — don't pop the tour
      // on an error; a later successful load will decide.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const closeOnboarding = useCallback((open: boolean) => {
    setOnboardingOpen(open);
    if (!open) {
      // Fast-path for this browser, plus persist per-account so every device
      // skips the tour from now on. Fire-and-forget: a failed PUT just means the
      // tour may reappear on another device until it succeeds.
      localStorage.setItem(ONBOARDED_KEY, "1");
      updateSettings({ onboarded: true }).catch(() => {});
    }
  }, []);

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
      const next = params.size ? `${pathname}?${params}` : pathname;
      const current = searchParams.size ? `${pathname}?${searchParams}` : pathname;
      // Search results come from the client useSearch hook; the URL is only for
      // refresh/share, so mirror it shallowly (no RSC round-trip per keystroke).
      if (next !== current) shallowReplace(next);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, pathname, shallowReplace, searchParams]);

  const [refreshKey, refresh] = useRefresh();
  const meta = useMeta(refreshKey);
  const health = useHealth(refreshKey);
  const list = useBookmarks(filters, refreshKey);
  // The grid shows hybrid results (keyword + semantic lists fused with RRF,
  // most relevant first); the Ask AI dock (?ai) opens beside that, not over it.
  const search = useSearch(query, "hybrid", refreshKey);
  const sessions = useSessions(refreshKey);

  // A fresh signup's DB may still be provisioning; every hook hits the same API,
  // so any of them reporting it means the account isn't ready. One page-level
  // state for the whole content area beats each section rendering its own
  // spinner/skeleton for the same wait.
  const settingUp = list.provisioning || meta.provisioning || sessions.provisioning;

  // The signed-in account isn't on the API allowlist (403). Every hook hits the
  // same API, so any one reporting it means no access — replace the whole content
  // area with an honest "switch account" notice instead of each list surface
  // showing the misleading "check that you're signed in" error.
  const noAccess =
    list.forbidden || meta.forbidden || sessions.forbidden || search.forbidden;

  // Saved sessions are a distinct section, keyed off ?section=sessions so the
  // extension can deep-link into it right after saving a session. Live open tabs
  // are their own section at ?section=live.
  const sessionsActive = searchParams.get("section") === "sessions";
  const liveActive = searchParams.get("section") === "live";

  const searching = query.trim().length > 0;
  // Hybrid results arrive sectioned: keyword hits (exact) up top, semantic
  // "related" matches behind a toggle so one search isn't a wall of results.
  const searchResults = search.data?.results ?? null;
  const exactMatches = useMemo(
    () => searchResults?.filter((r) => r.exact).map((r) => r.bookmark) ?? null,
    [searchResults],
  );
  const relatedMatches = useMemo(
    () => searchResults?.filter((r) => !r.exact).map((r) => r.bookmark) ?? null,
    [searchResults],
  );
  // No keyword hits at all → the closest semantic matches ARE the results.
  const noExact = searchResults != null && (exactMatches?.length ?? 0) === 0;
  const bookmarks = searching
    ? searchResults
      ? noExact
        ? relatedMatches
        : exactMatches
      : null
    : list.bookmarks;
  const [showRelated, setShowRelated] = useState(false);
  // Two result kinds → two tabs (Bookmarks default); only shown when
  // sessions actually matched.
  const [resultsTab, setResultsTab] = useState<"bookmarks" | "sessions">("bookmarks");
  useEffect(() => {
    setShowRelated(false);
    setResultsTab("bookmarks");
  }, [query]);
  const sessionMatches = search.data?.sessionResults ?? [];
  const showingSessionsTab = resultsTab === "sessions" && sessionMatches.length > 0;

  // Facet switches keep the previous list on screen while the new one loads
  // (useBookmarks preserves stale data across a filter change). With shallow
  // routing the heading/sidebar swap instantly, so dim that stale grid to show
  // the load is happening rather than leaving it looking frozen. Search has its
  // own keep-previous behaviour and is debounced per keystroke, so it's excluded
  // to avoid the grid pulsing on every character.
  const gridDimmed = !searching && list.loading && (list.bookmarks?.length ?? 0) > 0;

  // Group the content by relative date unless searching or a specific date
  // filter (range or single day) is active — then show a flat, filtered list.
  const grouped = !searching && !filters.from && !filters.to && !filters.day;

  // A genuinely empty library — no bookmarks at all, nothing filtering them out
  // — is a new user's first screen, so the grid onboards there. meta.total is
  // the authority on "zero overall"; list.total only counts what the active
  // filter matched, and a search that found nothing is a different message.
  const anyFilter = FILTER_KEYS.some((key) => filters[key]);
  const firstRun = !searching && !anyFilter && meta.data?.total === 0;

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

  // Section is view-state only (data via useSessions) → shallow, instant swap.
  // The Ask AI dock rides along (?ai preserved) so switching sections never
  // tears down an open conversation — that persistence is the whole point.
  const showSection = useCallback(
    (section: "sessions" | "live") => {
      setQuery("");
      const params = new URLSearchParams();
      params.set("section", section);
      if (searchParams.get(AI_PARAM) === "1") params.set(AI_PARAM, "1");
      shallowPush(`${pathname}?${params}`);
    },
    [shallowPush, pathname, searchParams],
  );
  const showSessions = useCallback(() => showSection("sessions"), [showSection]);
  const showLive = useCallback(() => showSection("live"), [showSection]);

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
  const crumb = sessionsActive || liveActive ? null : headerCrumb(filters);
  const title = sessionsActive ? "Saved sessions" : liveActive ? "Live sessions" : "All bookmarks";

  // The Ask AI dock is mounted at the layout level (AppChatDock) and driven
  // purely by ?ai — this page only reflects the button's pressed state and
  // toggles the param. Toggling preserves the rest of the URL (facets/search).
  const aiActive = searchParams.get(AI_PARAM) === "1";
  const toggleAi = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (params.get(AI_PARAM) === "1") {
      params.delete(AI_PARAM);
    } else {
      params.set(AI_PARAM, "1");
      // Flush the live search box into ?q so the dock (which reads the URL, not
      // this component's state) seeds the fresh chat with what's typed right now,
      // even if the debounced mirror hasn't fired yet.
      const q = query.trim();
      if (q) params.set("q", q);
    }
    shallowPush(params.size ? `${pathname}?${params}` : pathname);
  }, [searchParams, pathname, shallowPush, query]);

  return (
    <SidebarProvider>
      <AppSidebar
        meta={meta.data}
        metaLoading={meta.loading}
        aiEnabled={health.data ? health.data.ai : health.error ? false : null}
        filters={filters}
        onFilterChange={setFilters}
        sessionsActive={sessionsActive}
        sessionCount={sessions.data?.sessions.length ?? null}
        sessionsLoading={sessions.loading}
        onShowSessions={showSessions}
        liveActive={liveActive}
        onShowLive={showLive}
        onAdd={() => setAddOpen(true)}
        onOpenSettings={openSettings}
        onOpenTour={() => setOnboardingOpen(true)}
      />
      <SidebarInset>
        <LibraryHeader
          title={title}
          crumb={crumb}
          onRootClick={() => setFilters({})}
          query={query}
          aiActive={aiActive}
          onQueryChange={setQuery}
          onAskAi={toggleAi}
        />
        {/* Reserve right-side space for the layout-level docked chat (side mode
            only) so content squeezes beside it instead of hiding under it; the
            var is 0px in overlay/full/closed states. See chat-panel.tsx. */}
        <div
          className="flex min-w-0 flex-1 items-stretch"
          style={{ paddingRight: "var(--chat-dock-w, 0px)" }}
        >
        <main className="min-w-0 flex-1 p-4">
          {/* Width-capped and centered so content isn't stretched thin on
              widescreen/desktop; full-bleed below the cap on smaller screens. */}
          <div className="mx-auto w-full max-w-7xl">
            {settingUp ? (
              <AccountSetup />
            ) : noAccess ? (
              <NoAccessNotice />
            ) : liveActive ? (
              // Mounted ONLY while section=live, so its SSE/live hook (gated on
              // visibility) holds no connection outside this view.
              <div>
                <h2 className="mb-4 text-lg font-semibold tracking-tight">Live sessions</h2>
                <OngoingView onSaved={refresh} onOpenSettings={openSettings} />
              </div>
            ) : sessionsActive ? (
              <SessionsPanel
                savedSessions={sessions.data?.sessions ?? null}
                savedLoading={sessions.loading}
                savedError={sessions.error}
                onDeleteSaved={handleSessionDelete}
              />
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
                {/* Both result kinds matched → a tab per kind, Bookmarks first. */}
                {searching && sessionMatches.length > 0 && (
                  <div className="mb-4 flex items-center gap-1.5">
                    <Button
                      variant={showingSessionsTab ? "ghost" : "secondary"}
                      size="sm"
                      onClick={() => setResultsTab("bookmarks")}
                    >
                      Bookmarks
                      <span className="ml-1 tabular-nums text-muted-foreground">
                        {bookmarks?.length ?? 0}
                      </span>
                    </Button>
                    <Button
                      variant={showingSessionsTab ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setResultsTab("sessions")}
                    >
                      Sessions
                      <span className="ml-1 tabular-nums text-muted-foreground">
                        {sessionMatches.length}
                      </span>
                    </Button>
                  </div>
                )}
                {showingSessionsTab && searching ? (
                  <div className="flex flex-col gap-3">
                    {sessionMatches.map(({ session }) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        onDelete={handleSessionDelete}
                        highlight={query}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                {searching && noExact && (bookmarks?.length ?? 0) > 0 && (
                  <p className="mb-3 text-sm text-muted-foreground">
                    No exact matches — showing the closest results by meaning.
                  </p>
                )}
                <BookmarkGrid
                  bookmarks={bookmarks}
                  view={view}
                  grouped={grouped}
                  loading={searching ? search.loading : list.loading}
                  error={searching ? search.error : list.error}
                  firstRun={firstRun}
                  dimmed={gridDimmed}
                  onAdd={() => setAddOpen(true)}
                  emptyHint={
                    searching
                      ? "No matches. Try different words, or Ask AI for an answer."
                      : "Save a page with the browser extension, or add a URL with the button above."
                  }
                  onDelete={handleDelete}
                />
                {searching && !noExact && (relatedMatches?.length ?? 0) > 0 && (
                  <section className="mt-8">
                    {showRelated ? (
                      <>
                        <div className="mb-3 flex items-baseline justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <h3 className="text-sm font-semibold tracking-tight">
                              Related results
                            </h3>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {relatedMatches!.length}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              · matched by meaning, not exact words
                            </span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setShowRelated(false)}>
                            Hide
                          </Button>
                        </div>
                        <BookmarkGrid
                          bookmarks={relatedMatches}
                          view={view}
                          grouped={false}
                          loading={false}
                          error={null}
                          emptyHint=""
                          onDelete={handleDelete}
                        />
                      </>
                    ) : (
                      <div className="flex justify-center">
                        <Button variant="outline" size="sm" onClick={() => setShowRelated(true)}>
                          Show {relatedMatches!.length} related result
                          {relatedMatches!.length === 1 ? "" : "s"}
                        </Button>
                      </div>
                    )}
                  </section>
                )}
                  </>
                )}
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
        </div>
      </SidebarInset>
      <AddBookmarkDialog open={addOpen} onOpenChange={setAddOpen} onSaved={refresh} />
      <SettingsDialog
        open={settings.open}
        initialSection={settings.section}
        onOpenChange={(open) => {
          setSettings((s) => ({ ...s, open }));
          if (!open) clearSettingsParam();
        }}
      />
      <OnboardingDialog open={onboardingOpen} onOpenChange={closeOnboarding} />
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
