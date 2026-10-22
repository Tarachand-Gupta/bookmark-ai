"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Bookmark, OrganizationOperation } from "@bookmark-ai/types";
import { useAuth } from "@/lib/auth";
import { readBatchJob, type OrganizationBatchJob } from "@/lib/organization-batches";
import { useOrganization } from "@/hooks/use-organization";
import { freezeOrganizationSelection, getBookmark } from "@/lib/api";
import { resolveSelectedBookmarks } from "@/lib/organization-export";
import { expectedBookmarkVersions, operationSummary } from "@/lib/organization-ui";
import { OrganizationLibraryControls } from "./organization/library-controls";
import { BookmarkEditor } from "./organization/bookmark-editor";
import { BulkEditor, type BulkAction } from "./organization/bulk-editor";
import { RecentChanges } from "./organization/recent-changes";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  X,
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
import { AI_PARAM, useAppShellLayout } from "@/hooks/use-app-layout";
import {
  useBookmarks,
  useHealth,
  useMeta,
  useRefresh,
  useSearch,
  useSessions,
} from "@/hooks/use-library";
import { useSelection } from "@/hooks/use-selection";
import { runBulk } from "@/lib/bulk";
import { cn } from "@/lib/utils";
import { downloadBookmarksCsv, downloadSessionsCsv } from "@/lib/csv";
import { NoAccessNotice } from "@/components/no-access-notice";
import { DASHBOARD_PATH } from "@/components/dashboard/links";
import { AccountSetup } from "./account-setup";
import { AppSidebar } from "./app-sidebar";
import { BookmarkGrid } from "./bookmark-grid";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { LibraryHeader, type HeaderCrumb } from "./library-header";
import { MobileFilterBar } from "./mobile-filter-bar";
import { SelectionBar } from "./selection-bar";
import { TagChips } from "./tag-chips";
import { ViewToggle } from "./view-toggle";
import { useBookmarkView } from "@/hooks/use-bookmark-view";
import { DateRangeFilter } from "./date-range-filter";
import { SessionCard } from "./sessions-view";
import { SessionsPanel } from "./sessions-panel";
import { OngoingView } from "./ongoing-view";
import { SECTION_IDS, SettingsDialog, type SectionId } from "./settings-dialog";
import { AddBookmarkDialog } from "./add-bookmark-dialog";
import { OnboardingDialog } from "./onboarding-dialog";

/** Parallel DELETEs per bulk action. Enough to feel instant on a big selection,
 * low enough to stay clear of the API's 120-req/60s window with room to spare. */
const DELETE_CONCURRENCY = 6;

/** First-run tour fast-path: set once this account has dismissed the tour (on
 * this browser). The server flag `settings.onboardedAt` is the authority — this
 * only avoids a flash/refetch on subsequent loads before settings resolve. */
const ONBOARDED_KEY = "bmk:onboarded";

const FILTER_KEYS = ["category", "browser", "device", "day", "tag", "from", "to", "categoryId", "tagId"] as const;

// The `?ai=1` flag (AI_PARAM, from the layout store) opens the Ask AI dock. The
// dock itself lives at the /app layout level (see AppChatDock) — this page only
// reads/toggles the param for the header button and preserves it across
// navigation, and hands the same flag to the layout store so the sidebar can
// make room for the dock (see below).

/**
 * The whole library view. Facet filters live in the URL (shareable,
 * back-button friendly); search is local state layered on top.
 */
export function LibraryPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Only for leaving the shared library (Home). Library navigation is shallow
  // history state — see shallowPush below.
  const router = useRouter();
  // Home is one click away in the sidebar; warm it so the hop is instant.
  useEffect(() => {
    router.prefetch(DASHBOARD_PATH);
  }, [router]);

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
      const target = "/app/library";
      shallowPush(params.size ? `${target}?${params}` : target);
    },
    [shallowPush, pathname, searchParams],
  );

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [addOpen, setAddOpen] = useState(false);
  // Owned here, not inside TagChips: the expanded chip cloud needs a full-width
  // row of the toolbar's flex container to itself (see the wrapper below).
  const [tagsExpanded, setTagsExpanded] = useState(false);
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

  const { view, changeView } = useBookmarkView();

  // URL navigation owns the query; pending typing cannot overwrite Back/Forward.
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (queryTimer.current) clearTimeout(queryTimer.current);
    setQuery(searchParams.get("q") ?? "");
  }, [pathname, searchParams]);
  useEffect(() => () => { if (queryTimer.current) clearTimeout(queryTimer.current); }, []);
  const changeQuery = (value: string) => {
    setQuery(value);
    if (queryTimer.current) clearTimeout(queryTimer.current);
    queryTimer.current = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (value.trim()) { params.set("q", value.trim()); params.delete("section"); } else params.delete("q");
      const target = window.location.pathname;
      shallowReplace(`${target}${params.size ? `?${params}` : ""}`);
    }, 250);
  };

  const [refreshKey, refresh] = useRefresh();
  const meta = useMeta(refreshKey);
  const health = useHealth(refreshKey);
  const list = useBookmarks(filters, refreshKey);
  // The grid shows hybrid results (keyword + semantic lists fused with RRF,
  // most relevant first); the Ask AI dock (?ai) opens beside that, not over it.
  const search = useSearch(query, "hybrid", refreshKey, filters);
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
  const { userId } = useAuth();
  const [resumeBatch, setResumeBatch] = useState<OrganizationBatchJob | null>(null);
  useEffect(() => {
    const update = () => { try { setResumeBatch(userId ? readBatchJob(localStorage, userId) : null); } catch { setResumeBatch(null); } };
    update(); window.addEventListener("bookmark-batch-changed", update);
    return () => window.removeEventListener("bookmark-batch-changed", update);
  }, [userId]);
  const [selectionVersions, setSelectionVersions] = useState<Record<string, Record<string, string>>>({});
  const organization = useOrganization(refreshKey);
  const [editorBookmark, setEditorBookmark] = useState<Bookmark | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [latestOperation, setLatestOperation] = useState<OrganizationOperation | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkResumeJob, setBulkResumeJob] = useState<OrganizationBatchJob | null>(null);
  const [bulkExpected, setBulkExpected] = useState<Record<string, Record<string, string>>>({});

  const [selectingAll, setSelectingAll] = useState(false);
  const [selectionNote, setSelectionNote] = useState<string | null>(null);
  useEffect(() => { setBulkAction(null); setBulkIds([]); setBulkExpected({}); setBulkResumeJob(null); }, [userId]);
  const operationResult = (operation: OrganizationOperation) => { setLatestOperation(operation); refresh(); organization.refresh(); };
  useEffect(() => {
    const id = searchParams.get("bookmark"); if (!id || !organization.supported) return;
    let cancelled = false;
    void getBookmark(id).then(({ bookmark }) => { if (!cancelled) setEditorBookmark(bookmark); }).catch(err => { if (!cancelled) setSelectionNote(err.message); });
    return () => { cancelled = true; };
  }, [searchParams.get("bookmark"), organization.supported]);
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

  // A facet switch replaces the list wholesale, so it gets the skeleton: the
  // heading/sidebar swap instantly under shallow routing, and a dimmed list from
  // the filter the user just left read as a frozen screen. A same-filter refetch
  // (post-save/delete revalidate) keeps its still-current list, dimmed with a
  // spinner. Search is excluded from both — it keeps its previous results and is
  // debounced per keystroke, so it would pulse on every character.
  const gridFresh = !searching && list.freshFilter;
  const gridDimmed =
    !searching && !list.freshFilter && list.loading && (list.bookmarks?.length ?? 0) > 0;

  // Group the content by relative date unless searching or a specific date
  // filter (range or single day) is active — then show a flat, filtered list.
  const grouped = !searching && !filters.from && !filters.to && !filters.day;

  // How many bookmarks the facet the user just clicked is known to hold, from
  // /api/meta — so the skeleton draws roughly the right number of shapes instead
  // of always eight. Undefined when the count isn't knowable (no facet, a tag +
  // date-range combination, a facet meta hasn't seen yet), and the grid falls
  // back to its per-layout default.
  const expectedCount = useMemo(() => {
    const m = meta.data;
    if (!m || searching) return undefined;
    if (filters.from || filters.to) return undefined; // no per-range counts
    if (filters.category) return m.categories.find((c) => c.name === filters.category)?.count;
    if (filters.browser) return m.browsers.find((b) => b.name === filters.browser)?.count;
    if (filters.device) return m.devices.find((d) => d.name === filters.device)?.count;
    if (filters.day) return m.days.find((d) => d.day === filters.day)?.count;
    if (filters.tag) return m.tags.find((t) => t.name === filters.tag)?.count;
    return m.total;
  }, [meta.data, searching, filters]);

  // A genuinely empty library — no bookmarks at all, nothing filtering them out
  // — is a new user's first screen, so the grid onboards there. meta.total is
  // the authority on "zero overall"; list.total only counts what the active
  // filter matched, and a search that found nothing is a different message.
  const anyFilter = FILTER_KEYS.some((key) => filters[key]);
  const firstRun = !searching && !anyFilter && meta.data?.total === 0;

  // ── Selection, deletion ───────────────────────────────────────────────────
  // One selection per PAGE: the scope key names what's on screen, so any facet
  // change, section switch, or search activation drops it (see useSelection).
  // Search results are excluded entirely — the bar's Delete would otherwise act
  // on rows that a re-ranked query has already replaced.
  const scopeKey = useMemo(
    () =>
      [
        sessionsActive ? "sessions" : liveActive ? "live" : "library",
        searching ? `search:${query}` : "browse",
        FILTER_KEYS.map((k) => `${k}=${filters[k] ?? ""}`).join("&"),
      ].join("|"),
    [sessionsActive, liveActive, searching, query, filters],
  );
  useEffect(() => { setSelectionVersions({}); setSelectionNote(null); }, [scopeKey]);
  const selection = useSelection(scopeKey, !!bulkAction || !!editorBookmark);
  // Live sessions aren't deletable rows (they're a mirror of open tabs), and
  // search results use the same frozen-ID selection as the library.
  const selectable = !liveActive && !showingSessionsTab;
  const gridSelection = selectable && !sessionsActive ? selection : null;
  const sessionSelection = selectable && sessionsActive ? selection : null;
  const allVisibleBookmarks = searching ? (searchResults ?? []).map(r => r.bookmark) : list.bookmarks ?? [];
  const displayedBookmarks = searching && !noExact && showRelated ? [...(bookmarks ?? []), ...(relatedMatches ?? [])] : bookmarks ?? [];
  const selectAllMatches = async () => {
    setSelectingAll(true); setSelectionNote(null);
    try {
      const { selection: snapshot } = await freezeOrganizationSelection(searching ? { search: { ...filters, q: query, mode: "hybrid" } } : { query: filters });
      const label = snapshot.limited ? `Select the top ${snapshot.count} ranked results? This is a limited ranked set, not every possible match.` : `Select all ${snapshot.count} matching bookmarks?`;
      if (window.confirm(label)) { selection.set(snapshot.bookmarkIds); setSelectionVersions(snapshot.fieldVersions ?? {}); setSelectionNote(snapshot.limited ? `${snapshot.count} top ranked results selected. IDs are frozen.` : `${snapshot.count} matching bookmarks selected. IDs are frozen.`); }
    } catch (err) { setSelectionNote((err as Error).message); } finally { setSelectingAll(false); }
  };
  useEffect(() => {
    const context = selection.ids.size && selection.ids.size <= 1000 ? { type: "bookmarks", bookmarkIds: [...selection.ids] } : undefined;
    window.dispatchEvent(new CustomEvent("bookmark-chat-context", { detail: { context } }));
    return () => { window.dispatchEvent(new CustomEvent("bookmark-chat-context", { detail: {} })); };
  }, [selection.ids]);
  const askSelection = () => {
    if (selection.ids.size > 1000) { setSelectionNote("Ask AI accepts up to 1,000 selected bookmarks. Reduce this selection before asking AI."); return; }
    window.dispatchEvent(new CustomEvent("bookmark-chat-context", { detail: { context: { type: "bookmarks", bookmarkIds: [...selection.ids] }, open: true, adopt: true } }));
  };


  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** What the confirmation dialog is about to delete. */
  const [pending, setPending] = useState<{
    kind: "bookmark" | "session";
    ids: string[];
    label: string;
  } | null>(null);
  /** Progress of the delete now running, or null when nothing is in flight. */
  const [deleting, setDeleting] = useState<{ done: number; total: number } | null>(null);

  const savedSessions = sessions.data?.sessions ?? null;

  // The dialog names what it's deleting, so the title is looked up across every
  // list a delete button can appear in — the visible set first (search results
  // or the filtered list), then the "related" section, then the loaded pages.
  const askDeleteBookmark = useCallback(
    (id: string) => {
      setNotice(null);
      const title =
        (bookmarks ?? []).find((b) => b.id === id)?.title ??
        (relatedMatches ?? []).find((b) => b.id === id)?.title ??
        (list.bookmarks ?? []).find((b) => b.id === id)?.title;
      setPending({ kind: "bookmark", ids: [id], label: title || "this bookmark" });
    },
    [bookmarks, relatedMatches, list.bookmarks],
  );

  const askDeleteSession = useCallback(
    (id: string) => {
      setNotice(null);
      const name =
        savedSessions?.find((s) => s.id === id)?.name ??
        sessionMatches.find(({ session }) => session.id === id)?.session.name;
      setPending({ kind: "session", ids: [id], label: name || "this session" });
    },
    [savedSessions, sessionMatches],
  );

  const askDeleteSelected = useCallback(() => {
    if (selection.count === 0) return;
    setNotice(null);
    // The noun IS the kind here ("3 sessions" / "3 bookmarks").
    const kind = sessionsActive ? "session" : "bookmark";
    setPending({
      kind,
      ids: [...selection.ids],
      label: `${selection.count} ${kind}${selection.count === 1 ? "" : "s"}`,
    });
  }, [selection.count, selection.ids, sessionsActive]);

  /**
   * Run the pending delete. Requests go out `DELETE_CONCURRENCY` at a time and
   * every failure is counted rather than aborting the batch (see lib/bulk.ts), so
   * the summary can be honest about a partial success.
   */
  const runDelete = useCallback(async () => {
    if (!pending) return;
    const { kind, ids } = pending;
    const remove = kind === "session" ? deleteSession : deleteBookmark;
    setDeleting({ done: 0, total: ids.length });
    const { failed, firstError } = await runBulk(ids, remove, {
      concurrency: DELETE_CONCURRENCY,
      onSettled: (done) => {
        // flushSync, not a bare setState: these updates arrive from concurrent
        // request callbacks, and React is free to coalesce them with the
        // teardown (`setDeleting(null)`) that follows the batch — which is
        // exactly what left the dialog reading "Deleted 0 of N" from the first
        // frame to the last. Committing each tick synchronously is what makes
        // the progress line actually move.
        flushSync(() => setDeleting((d) => (d ? { ...d, done } : d)));
      },
    });
    const deleted = ids.length - failed;
    setDeleting(null);
    setPending(null);
    selection.clear();
    if (failed === 0) {
      setNotice({
        tone: "ok",
        text: `Deleted ${deleted} ${kind}${deleted === 1 ? "" : "s"}.`,
      });
    } else {
      setNotice({
        tone: "error",
        text:
          deleted === 0
            ? `Couldn’t delete ${failed === 1 ? `that ${kind}` : `any of the ${failed} ${kind}s`}: ${firstError}`
            : `Deleted ${deleted} of ${ids.length} ${kind}s — ${failed} failed: ${firstError}`,
      });
    }
    refresh();
  }, [pending, refresh, selection]);

  const [exporting, setExporting] = useState(false);
  const exportSelected = async () => {
    if (selection.count === 0 || exporting) return;
    if (sessionsActive) {
      downloadSessionsCsv((savedSessions ?? []).filter(session => selection.has(session.id)));
      return;
    }
    setExporting(true);
    try {
      const rows = await resolveSelectedBookmarks([...selection.ids], allVisibleBookmarks, async id => (await getBookmark(id)).bookmark);
      downloadBookmarksCsv(rows);
    } catch (error) {
      setNotice({ tone: "error", text: `Could not export the full selection: ${(error as Error).message}` });
    } finally { setExporting(false); }
  };

  // Section is view-state only (data via useSessions) → shallow, instant swap.
  // The Ask AI dock rides along (?ai preserved) so switching sections never
  // tears down an open conversation — that persistence is the whole point.
  const showSection = useCallback(
    (section: "sessions" | "live") => {
      setQuery("");
      const params = new URLSearchParams();
      params.set("section", section);
      if (searchParams.get(AI_PARAM) === "1") params.set(AI_PARAM, "1");
      shallowPush(`/app/library?${params}`);
    },
    [shallowPush, pathname, searchParams],
  );
  const showSessions = useCallback(() => showSection("sessions"), [showSection]);
  const showLive = useCallback(() => showSection("live"), [showSection]);

  // Breadcrumb: root view + the active facet; search presents in the content area.
  const crumb = sessionsActive || liveActive ? null : headerCrumb(filters);
  const title = sessionsActive ? "Saved sessions" : liveActive ? "Live sessions" : "All bookmarks";

  // The Ask AI dock is mounted at the layout level (AppChatDock) and driven
  // purely by ?ai — this page only reflects the button's pressed state and
  // toggles the param. Toggling preserves the rest of the URL (facets/search).
  const aiActive = searchParams.get(AI_PARAM) === "1";
  // ONE arbiter for sidebar × dock × content (lib/app-layout.ts): with the dock
  // open, the sidebar is forced to its icon rail before the main pane may drop
  // under two card columns, and the dock floats only when even the rail can't
  // keep it. The provider is CONTROLLED off that decision; the user's own toggle
  // goes back into the store (re-expanding a forced rail wins — the dock floats).
  const shell = useAppShellLayout(aiActive);
  const toggleAi = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (params.get(AI_PARAM) === "1") {
      params.delete(AI_PARAM);
    } else {
      // Opening only toggles the panel — the chat starts EMPTY. It deliberately
      // does not inherit the search box: an auto-sent question the user never
      // asked burned a turn and buried the prompt they actually wanted.
      params.set(AI_PARAM, "1");
    }
    shallowPush(params.size ? `${pathname}?${params}` : pathname);
  }, [searchParams, pathname, shallowPush]);

  return (
    <SidebarProvider open={shell.sidebar === "expanded"} onOpenChange={shell.setSidebarOpen}>
      <AppSidebar
        meta={meta.data}
        metaLoading={meta.loading}
        aiEnabled={health.data ? health.data.ai : health.error ? false : null}
        filters={filters}
        onFilterChange={setFilters}
        onShowHome={() => router.push(DASHBOARD_PATH)}
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
          onOpenAccount={() => openSettings("account")}
          title={title}
          crumb={crumb}
          onRootClick={() => setFilters({})}
          query={query}
          aiActive={aiActive}
          onQueryChange={changeQuery}
          onAskAi={toggleAi}
        />
        {/* Reserve right-side space for the layout-level docked chat (side mode
            only) so content squeezes beside it instead of hiding under it; the
            var is 0px in overlay/full/closed states. See chat-panel.tsx. The
            grid inside sizes its columns from THIS width (auto-fill), so the
            reservation is all it takes to keep the cards readable. */}
        <div
          className="flex min-w-0 flex-1 items-stretch"
          style={{ paddingRight: "var(--chat-dock-w, 0px)" }}
        >
        {/* p-3 at mobile widths — 16px gutters either side of a 390px screen left
            the cards noticeably narrower than they need to be. */}
        <main className="min-w-0 flex-1 p-3 sm:p-4" style={{ paddingBottom: "calc(7rem + var(--floating-composer-h, 0px))" }}>
          {/* Width-capped and centered so content isn't stretched thin on
              widescreen/desktop; full-bleed below the cap on smaller screens. */}
          <div className="mx-auto w-full max-w-7xl">

            {organization.error && <p className="mb-4 text-sm text-muted-foreground" role="status">Organization editing is unavailable. Check your connection, or update an older server to use organization editing. <button className="underline" onClick={organization.refresh}>Retry</button></p>}
            {resumeBatch && !bulkAction && <div role="status" className="mb-3 flex items-center gap-3 rounded border p-3 text-sm"><span className="flex-1">A bulk edit of {resumeBatch.bookmarkIds.length} bookmarks is paused or awaiting confirmation.</span><Button size="sm" onClick={() => { setBulkIds(resumeBatch.bookmarkIds); setBulkResumeJob(resumeBatch); setBulkAction("category"); }}>Review and resume</Button></div>}
            {selectionNote && <p role="status" className="mb-3 text-sm">{selectionNote}</p>}
            {latestOperation && <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><span className="flex-1">{operationSummary(latestOperation)}</span><Button size="sm" variant="outline" onClick={() => setRecentOpen(true)}>{latestOperation.failedCount ? "View results / Retry failed" : "Undo / View results"}</Button></div>}
            {/* Above the section switch, not inside the library branch: a bulk
                delete of SESSIONS has to be able to report itself too. */}
            {notice && <ActionNotice notice={notice} onDismiss={() => setNotice(null)} />}
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
                savedSessions={savedSessions}
                savedLoading={sessions.loading}
                savedError={sessions.error}
                onDeleteSaved={askDeleteSession}
                onRenamedSaved={refresh}
                selection={sessionSelection}
                onSelectMode={selection.setMode}
              />
            ) : (
              <>
                {organization.data && !showingSessionsTab && <OrganizationLibraryControls selected={selection.active} onSelectLoaded={() => { setSelectionVersions({}); selection.set(displayedBookmarks.map(b => b.id)); }} onSelectAll={() => void selectAllMatches()} selectingAll={selectingAll} search={searching} />}
                {/* Two filter surfaces, one per breakpoint. ≥md keeps the tag
                    rail + date-range popover beside the view toggle; <md hides
                    the rail (a sideways-scrolling strip of 11px chips) and shows
                    the drawer-backed control row instead. */}
                <div className="mb-4 flex flex-wrap items-start gap-3">
                  {searching ? (
                    <>
                      <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                        Results for “{query.trim()}”
                      </h2>
                      <ViewToggle view={view} onChange={changeView} className="ml-auto" />
                    </>
                  ) : (
                    <>
                      {/* Wrapper, not a class on TagChips: its own base class sets
                          `flex`, and an unprefixed `hidden` alongside it is a
                          coin-flip on stylesheet order.

                          Expanded, the wrapper claims a full line of its own:
                          `w-full` + `flex-none` on a flex-wrap parent forces a
                          line break, and `order-last` puts that line BELOW the
                          Date + view controls, which keep row one (right-aligned,
                          as before, via their ml-auto). Without this the wrapped
                          chip cloud grew inside the shared row and ran straight
                          into those controls. The two states are written as
                          mutually exclusive classes, not one overriding the other:
                          `flex-1` and `flex-none` set the same `flex` shorthand,
                          so which won would come down to stylesheet order. */}
                      <div
                        className={cn(
                          "hidden min-w-0 md:block",
                          tagsExpanded ? "md:order-last md:w-full md:flex-none" : "md:flex-1",
                        )}
                      >
                        <TagChips
                          tags={meta.data?.tags}
                          active={filters.tag}
                          onPick={(tag) => setFilters(tag ? { tag } : {})}
                          expanded={tagsExpanded}
                          onExpandedChange={setTagsExpanded}
                        />
                      </div>
                      <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
                        <DateRangeFilter
                          from={filters.from}
                          to={filters.to}
                          onChange={({ from, to }) => setFilters({ ...filters, from, to })}
                        />
                        <ViewToggle view={view} onChange={changeView} />
                      </div>
                      <MobileFilterBar
                        className="w-full md:hidden"
                        meta={meta.data}
                        filters={filters}
                        onFilterChange={setFilters}
                        view={view}
                        onViewChange={changeView}
                        onSelectMode={gridSelection ? selection.setMode : undefined}
                        selectionActive={selection.active}
                      />
                    </>
                  )}
                </div>
                {!searching && filters.tag && (
                  <div className="mb-4 flex items-baseline gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">#{filters.tag}</h2>
                    {/* Hidden mid-facet-switch: the count still belongs to the
                        PREVIOUS filter, and a wrong number under the new heading
                        is worse than no number for the second it takes. */}
                    {!gridFresh && (
                      <span className="text-sm text-muted-foreground">
                        {list.total} bookmark{list.total === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
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
                        onDelete={askDeleteSession}
                        onRenamed={refresh}
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
                  freshLoad={gridFresh}
                  onAdd={() => setAddOpen(true)}
                  emptyHint={
                    searching
                      ? "No matches. Try different words, or Ask AI for an answer."
                      : "Save a page with the browser extension, or add a URL with the button above."
                  }
                  onDelete={askDeleteBookmark}
                  onEdit={organization.supported ? setEditorBookmark : undefined}
                  skeletonCount={expectedCount}
                  selection={gridSelection}
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
                          onDelete={askDeleteBookmark}
                          onEdit={organization.supported ? setEditorBookmark : undefined}
                          selection={gridSelection}
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
                {/* Same reason as the tag count: hasMore/total describe the list
                    being replaced, so the pager sits out the switch. */}
                {!searching && !gridFresh && list.hasMore && (
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
      {/* Selection bar and confirmation live outside SidebarInset: both are
          fixed/portalled overlays that belong to the page as a whole. */}
      <SelectionBar
        count={selectable ? selection.count : 0}
        noun={sessionsActive ? "session" : "bookmark"}
        onDelete={askDeleteSelected}
        onExport={() => void exportSelected()}
        onClear={selection.clear}
        busy={!!deleting || exporting}
        onOrganize={!sessionsActive && organization.supported ? action => {
          const ids = [...selection.ids];
          const expected: Record<string, Record<string, string>> = {};
          for (const id of ids) {
            const bookmark = allVisibleBookmarks.find(item => item.id === id);
            if (!bookmark && !selectionVersions[id]) { setSelectionNote("Some selected bookmarks changed. Refresh and select them again before editing."); return; }
            expected[id] = selectionVersions[id] ? { title: "0", categoryId: "0", tags: "0", ...selectionVersions[id] } : expectedBookmarkVersions(bookmark!);
          }
          setBulkResumeJob(null); setBulkExpected(expected); setBulkIds(ids); setBulkAction(action);
        } : undefined}
        onAsk={!sessionsActive ? askSelection : undefined}
      />
      <ConfirmDeleteDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        label={pending?.label ?? ""}
        detail={
          pending && pending.ids.length > 1
            ? `${pending.ids.length} items will be deleted from every device.`
            : undefined
        }
        busy={!!deleting || exporting}
        progress={
          deleting && deleting.total > 1
            ? `Deleted ${deleting.done} of ${deleting.total}…`
            : null
        }
        onConfirm={() => void runDelete()}
      />
      <AddBookmarkDialog open={addOpen} onOpenChange={setAddOpen} onSaved={refresh} onEdit={organization.supported ? setEditorBookmark : undefined} />
      {organization.data && editorBookmark && <BookmarkEditor key={editorBookmark.id} bookmark={editorBookmark} data={organization.data} onClose={() => { setEditorBookmark(null); const params = new URLSearchParams(window.location.search); params.delete("bookmark"); window.history.replaceState(null, "", `${window.location.pathname}?${params}`); }} onResult={operationResult} onRefresh={organization.refresh} />}
      {organization.data && bulkAction && <BulkEditor key={`${userId}:${bulkResumeJob?.id ?? "selection"}`} resumeJob={bulkResumeJob} action={bulkAction} ids={bulkIds} bookmarks={allVisibleBookmarks} data={organization.data} expected={bulkExpected} onClose={() => { setBulkAction(null); setBulkResumeJob(null); }} onResult={operationResult} />}
      <RecentChanges open={recentOpen} onClose={() => setRecentOpen(false)} onResult={operationResult} latest={latestOperation} />
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

/**
 * Result of the last delete, dismissible. Bulk deletes report honestly: a
 * partial failure says how many of how many landed and why, rather than a bare
 * "Delete failed" that leaves the user guessing what state their library is in.
 */
function ActionNotice({
  notice,
  onDismiss,
}: {
  notice: { tone: "ok" | "error"; text: string };
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className={
        notice.tone === "error"
          ? "mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "mb-4 flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
      }
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{notice.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="cursor-pointer shrink-0 rounded p-0.5 transition-colors hover:bg-foreground/10"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
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
