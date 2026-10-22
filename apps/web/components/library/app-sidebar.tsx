"use client";
import type { OrganizationFolder, OrganizationResponse } from "@bookmark-ai/types";

import { useEffect, useState } from "react";
import type { MetaResponse } from "@bookmark-ai/types";
import {
  Bookmark,
  BookOpen,
  CircleDot,
  Hash,
  Inbox,
  CalendarDays,
  ChevronDown,
  Chrome,
  Compass,
  Flame,
  Folder,
  Globe,
  Home,
  Laptop,
  Monitor,
  Plug,
  Plus,
  Settings,
  Smartphone,
  Sparkles,
  Tablet,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge as BaseSidebarMenuBadge,
  SidebarMenuButton as BaseSidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryFilters } from "@/lib/api";
import { FEATURE_ICONS } from "./feature-icons";
import { Button } from "@/components/ui/button";
import { folderTreeRows } from "@/lib/organization-ui";
import { folderHref } from "@/lib/folder-browser";
import { FolderOptions, type FolderAction } from "./organization/folder-browser";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
import type { SectionId } from "./settings-dialog";

function SidebarMenuButton({ className = "", ...props }: React.ComponentProps<typeof BaseSidebarMenuButton>) {
  return <BaseSidebarMenuButton className={`min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:group-data-[collapsible=icon]:min-w-11 [@media(pointer:coarse)]:group-data-[collapsible=icon]:-translate-x-1.5 [@media(pointer:coarse)]:group-data-[collapsible=icon]:px-3.5! group-data-[collapsible=icon]:[&>span:last-child]:sr-only ${className}`} {...props} />;
}

function SidebarMenuBadge(props: React.ComponentProps<typeof BaseSidebarMenuBadge>) {
  return <BaseSidebarMenuBadge className="top-1/2! -translate-y-1/2" {...props} />;
}

/** Facet rows shown before a section needs its "View all" toggle. */
const VISIBLE_CATEGORIES = 6;

const BROWSER_ICONS: Record<string, React.ElementType> = {
  chrome: Chrome,
  firefox: Flame,
  safari: Compass,
  edge: Globe,
  arc: Globe,
  other: Globe,
};

const DEVICE_ICONS: Record<string, React.ElementType> = {
  desktop: Monitor,
  laptop: Laptop,
  mobile: Smartphone,
  tablet: Tablet,
  other: Monitor,
};

export interface AppSidebarProps {
  meta: MetaResponse | null;
  /** /api/meta still in flight — facets show skeletons rather than nothing. */
  metaLoading?: boolean;
  aiEnabled: boolean | null;
  filters: LibraryFilters;
  onFilterChange: (filters: LibraryFilters) => void;
  /** Whether the Home dashboard (/app) is the current route, not the library. */
  homeActive?: boolean;
  foldersActive?: boolean;
  onBrowseFolder?: (id: string | null) => void;
  onCreateFolder?: (parentId: string | null) => void;
  onFolderAction?: (folder: OrganizationFolder, action: FolderAction) => void;
  aiActive?: boolean;
  /** Navigate to the Home dashboard. Omitted ⇒ the Home row isn't rendered. */
  onShowHome?: () => void;
  /** Whether the Saved sessions view (not the library) is showing. */
  sessionsActive?: boolean;
  sessionCount?: number | null;
  sessionsLoading?: boolean;
  onShowSessions?: () => void;
  /** Whether the Live sessions view (open tabs from every device) is showing. */
  liveActive?: boolean;
  onShowLive?: () => void;
  /** Opens the add-bookmark dialog (the + next to the branding). */
  onAdd?: () => void;
  /** Opens the settings modal at a section (owned by the page so other surfaces
   * can open it). The MCP row below passes "mcp"; Settings passes nothing. */
  onOpenSettings?: (section?: SectionId) => void;
  /** Reopens the first-run feature tour. */
  onOpenTour?: () => void;
  organization?: OrganizationResponse | null;
  onManageOrganization?: (intent?: "create-folder") => void;
}

/** "Docs & Reference · 8" — the rail tooltip carries the count the badge shows. */
function withCount(label: string, count: number | null | undefined): string {
  return count == null ? label : `${label} · ${count}`;
}

/**
 * Facet navigation: categories (AI), source browsers, devices, recent days.
 * Selecting a facet swaps the whole filter (one facet active at a time keeps
 * the mental model simple); selecting it again clears it.
 *
 * `collapsible="icon"`: collapsed, the sidebar is a 3rem rail of icons rather
 * than gone — the layout store (hooks/use-app-layout.ts) collapses it to make
 * room for the Ask AI dock, and the rail keeps every destination one click (and
 * one tooltip) away. Every row therefore carries a `tooltip`, the brand header
 * stacks its mark and the + button, and each facet group gets a rail-only rule
 * where its label used to be.
 */
export function AppSidebar({
  meta,
  metaLoading,
  filters,
  onFilterChange,
  homeActive,
  foldersActive,
  onBrowseFolder,
  onCreateFolder,
  onFolderAction,
  aiActive,
  onShowHome,
  sessionsActive,
  sessionCount,
  sessionsLoading,
  onShowSessions,
  liveActive,
  onShowLive,
  onAdd,
  onOpenSettings,
  onOpenTour,
  organization,
  onManageOrganization,
}: AppSidebarProps) {
  const { setOpenMobile, state, isMobile, setOpen } = useSidebar();
  const rail = state === "collapsed" && !isMobile;
  const manage = (intent?: "create-folder") => { setOpenMobile(false); onManageOrganization?.(intent); };
  const [allCategories, setAllCategories] = useState(false);
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const folderRows = folderTreeRows(organization?.folders ?? []);
  useEffect(() => { const active = folderRows.find(row => row.folder.id === filters.folderId); if (active) setClosedFolders(previous => new Set([...previous].filter(id => !active.ancestors.includes(id)))); }, [filters.folderId, organization?.folders]);

  const browse = (id: string | null) => { onBrowseFolder?.(id); setOpenMobile(false); };
  const select = (next: LibraryFilters) => {
    onFilterChange(next);
    setOpenMobile(false);
  };

  const noFilter = !filters.category && !filters.browser && !filters.device && !filters.day && !filters.folderId && !filters.readingState && !filters.categoryId && !filters.tagId;
  const categories = meta?.categories ?? [];
  const browsers = meta?.browsers ?? [];
  const devices = meta?.devices ?? [];
  const days = (meta?.days ?? []).slice(0, 7);
  // Facets are unknown, not absent, until meta lands. A failed request is
  // treated as empty, which drops those sections entirely (see CollapsibleGroup)
  // rather than leaving four headers over nothing.
  const facetsLoading = meta === null && !!metaLoading;
  // Keep the active category visible even when the list is folded.
  const visibleCategories =
    allCategories || categories.length <= VISIBLE_CATEGORIES
      ? categories
      : categories
          .slice(0, VISIBLE_CATEGORIES)
          .concat(categories.slice(VISIBLE_CATEGORIES).filter((c) => c.name === filters.category));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* On the rail the row becomes a column: the 32px brand mark over the
            32px + button, each exactly the rail's inner width (3rem − p-2), the
            wordmark and count hidden. */}
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            title="Bookmark AI"
          >
            <Bookmark className="size-4" aria-hidden />
          </div>
          <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-semibold">Bookmark AI</span>
            <span className="text-xs text-muted-foreground">
              {meta ? `${meta.total} saved` : "—"}
            </span>
          </div>
          {onAdd && (
            // Deliberately quiet next to the black brand mark: white fill,
            // hairline border, soft shadow — same treatment as the search input.
            <button
              type="button"
              onClick={onAdd}
              aria-label="Add bookmark"
              title="Add bookmark"
              className="cursor-pointer flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </SidebarHeader>

      {/* pb-2 reserves the gap the pinned footer's own padding doesn't cover, so
          the last facet row can be scrolled clear of Tour/Settings instead of
          ending up half-hidden behind them.

          The rail keeps scrolling (shadcn's default clips it): every facet is
          still a row there, and a tall list must not lose its last rows behind
          the footer. The scrollbar itself is hidden — a 3rem column has no room
          for one, and the wheel/trackpad still works. */}
      <SidebarContent className="pb-2 group-data-[collapsible=icon]:overflow-y-auto! group-data-[collapsible=icon]:[scrollbar-width:none]">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Home = the dashboard at /app (docs/features/dashboard.md §3).
                  Rendered only when the host page can navigate there, so the
                  sidebar keeps working anywhere it's reused. */}
              {onShowHome && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={!!homeActive}
                    tooltip="Home"
                    onClick={() => {
                      onShowHome();
                      setOpenMobile(false);
                    }}
                  >
                    <Home aria-hidden />
                    <span>Home</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!foldersActive && !homeActive && noFilter && !sessionsActive && !liveActive}
                  tooltip={withCount("All bookmarks", meta?.total)}
                  onClick={() => select({})}
                >
                  <FEATURE_ICONS.bookmarks aria-hidden />
                  <span>All bookmarks</span>
                </SidebarMenuButton>
                <CountBadge value={meta?.total} loading={facetsLoading} />
              </SidebarMenuItem>
              {organization && <>
                <SidebarMenuItem><SidebarMenuButton isActive={!!filters.readingState && !homeActive && !sessionsActive && !liveActive} tooltip="Reading list" onClick={() => select({ readingState: "unread" })}><BookOpen aria-hidden /><span>Reading list</span></SidebarMenuButton></SidebarMenuItem>
                <SidebarMenuItem><SidebarMenuButton isActive={filters.folderId === "unsorted" && !homeActive && !sessionsActive && !liveActive} tooltip="Unsorted" onClick={() => select({ folderId: "unsorted" })}><Inbox aria-hidden /><span>Unsorted</span></SidebarMenuButton></SidebarMenuItem>
              </>}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!!liveActive}
                  tooltip="Live sessions"
                  onClick={() => {
                    onShowLive?.();
                    setOpenMobile(false);
                  }}
                >
                  {/* Live sessions share the tour's Radio glyph; the emerald
                      pulse pip is what marks THIS surface as the live one. */}
                  <span className="relative flex shrink-0 items-center justify-center">
                    <FEATURE_ICONS.live aria-hidden className="size-4" />
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"
                    />
                  </span>
                  <span>Live sessions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!!sessionsActive}
                  tooltip={withCount("Saved sessions", sessionCount)}
                  onClick={() => {
                    onShowSessions?.();
                    setOpenMobile(false);
                  }}
                >
                  <FEATURE_ICONS.sessions aria-hidden />
                  <span>Saved sessions</span>
                </SidebarMenuButton>
                <CountBadge
                  value={sessionCount}
                  loading={sessionCount == null && !!sessionsLoading}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <div className="flex min-h-11 items-center md:min-h-8 group-data-[collapsible=icon]:hidden">
            <span className="mr-auto px-2 text-xs font-medium text-muted-foreground">Folders</span>
            {onManageOrganization && <>
              <Button type="button" variant="ghost" className="size-11 shrink-0 md:size-8 [@media(pointer:coarse)]:size-11" aria-label="Create folder" title="Create folder" onClick={() => { setOpenMobile(false); onCreateFolder ? onCreateFolder(null) : manage("create-folder"); }}><Plus aria-hidden /></Button>
            </>}
          </div>
          <SidebarGroupContent><SidebarMenu>
            {rail ? <>
              <SidebarMenuItem><SidebarMenuButton tooltip="Show folders" aria-label="Show folders" isActive={foldersActive} onClick={() => setOpen(true)}><Folder aria-hidden /><span>Folders</span></SidebarMenuButton></SidebarMenuItem>
            </> : <>
              {folderRows.filter(row => !row.ancestors.some(id => closedFolders.has(id))).map(({ folder, depth, hasChildren }) => {
                const expanded = !closedFolders.has(folder.id);
                const active = filters.folderId === folder.id && !homeActive && !sessionsActive && !liveActive;
                return <SidebarMenuItem key={folder.id} className="group/folder" style={{ marginLeft: Math.min(depth, 4) * 12 }}>
                  <SidebarMenuButton asChild className="relative min-w-0 pl-11 pr-11 md:pl-8 md:pr-8 [@media(pointer:coarse)]:pl-11 [@media(pointer:coarse)]:pr-11" isActive={active} tooltip={folder.path}>
                    <a href={folderHref(folder.id, aiActive)} aria-current={active ? "page" : undefined} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); browse(folder.id); }}>
                      {!hasChildren && <span className="absolute inset-y-0 left-0 flex w-11 items-center justify-center md:w-8 [@media(pointer:coarse)]:w-11"><Folder className="size-4" aria-hidden /></span>}
                      <span className="min-w-0 flex-1 truncate" title={folder.path}>{folder.name}</span>
                    </a>
                  </SidebarMenuButton>
                  {hasChildren && <button type="button" className="absolute inset-y-0 left-0 flex size-11 items-center justify-center rounded-md md:size-8 [@media(pointer:coarse)]:size-11 text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring" aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.path}`} aria-expanded={expanded} onClick={() => setClosedFolders(previous => { const next = new Set(previous); next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id); return next; })}>
                    <Folder aria-hidden className="size-4 transition-opacity group-hover/folder:opacity-0 group-focus-within/folder:opacity-0 max-md:opacity-0 [@media(hover:none)]:opacity-0" />
                    <ChevronDown aria-hidden className={`absolute size-4 opacity-0 transition-opacity group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100 ${expanded ? "" : "-rotate-90"}`} />
                  </button>}
                  <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs tabular-nums text-muted-foreground ${onFolderAction ? "group-hover/folder:opacity-0 group-focus-within/folder:opacity-0 group-has-[[data-state=open]]/folder:opacity-0 max-md:hidden [@media(hover:none)]:hidden" : ""}`}>{folder.directCount || ""}</span>
                  {onFolderAction && <FolderOptions folder={folder} onAction={(item, action) => { setOpenMobile(false); onFolderAction(item, action); }} onNew={onCreateFolder ? () => { setOpenMobile(false); onCreateFolder(folder.id); } : undefined} />}
                </SidebarMenuItem>;
              })}
              {!folderRows.length && <li className="px-2 py-2 text-xs text-muted-foreground">Create a folder to give your links a home.</li>}
            </>}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
        <CollapsibleGroup
          label="Topics"
          loading={facetsLoading}
          count={categories.length}
          railItem={{ Icon: CircleDot, active: !!filters.category || !!filters.categoryId }}
        >
          <SidebarMenu>
            {visibleCategories.map((c) => (
              <SidebarMenuItem key={c.name}>
                <SidebarMenuButton
                  isActive={filters.category === c.name}
                  tooltip={withCount(c.name, c.count)}
                  onClick={() => select(filters.category === c.name ? {} : { category: c.name })}
                >
                  <CircleDot aria-hidden />
                  <span>{c.name}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{c.count}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
            {categories.length > VISIBLE_CATEGORIES && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setAllCategories((v) => !v)}
                  tooltip={allCategories ? "Show fewer topics" : `All ${categories.length} topics`}
                  className="text-muted-foreground"
                >
                  <ChevronDown
                    aria-hidden
                    className={
                      allCategories ? "rotate-180 transition-transform" : "transition-transform"
                    }
                  />
                  <span>{allCategories ? "Show less" : `View all (${categories.length})`}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </CollapsibleGroup>

        <CollapsibleGroup label="Tags" loading={facetsLoading} count={organization?.tags.length ?? 0} railItem={{ Icon: Hash, active: !!filters.tagId }}>
          <SidebarMenu>{organization?.tags.map(tag => <SidebarMenuItem key={tag.id}><SidebarMenuButton isActive={filters.tagId === tag.id} tooltip={withCount(tag.name, tag.count)} onClick={() => select(filters.tagId === tag.id ? {} : { tagId: tag.id })}><Hash aria-hidden /><span>{tag.name}</span></SidebarMenuButton><SidebarMenuBadge>{tag.count}</SidebarMenuBadge></SidebarMenuItem>)}</SidebarMenu>
        </CollapsibleGroup>

        <CollapsibleGroup
          label="Browsers"
          loading={facetsLoading}
          count={browsers.length}
        >
          <SidebarMenu>
            {browsers.map((b) => {
              const Icon = BROWSER_ICONS[b.name] ?? Globe;
              return (
                <SidebarMenuItem key={b.name}>
                  <SidebarMenuButton
                    isActive={filters.browser === b.name}
                    tooltip={withCount(capitalize(b.name), b.count)}
                    onClick={() => select(filters.browser === b.name ? {} : { browser: b.name })}
                  >
                    <Icon aria-hidden />
                    <span className="capitalize">{b.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{b.count}</SidebarMenuBadge>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </CollapsibleGroup>

        <CollapsibleGroup
          label="Devices"
          loading={facetsLoading}
          count={devices.length}
        >
          <SidebarMenu>
            {devices.map((d) => {
              const Icon = DEVICE_ICONS[d.name] ?? Monitor;
              return (
                <SidebarMenuItem key={d.name}>
                  <SidebarMenuButton
                    isActive={filters.device === d.name}
                    tooltip={withCount(capitalize(d.name), d.count)}
                    onClick={() => select(filters.device === d.name ? {} : { device: d.name })}
                  >
                    <Icon aria-hidden />
                    <span className="capitalize">{d.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{d.count}</SidebarMenuBadge>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </CollapsibleGroup>

        <CollapsibleGroup
          label="Recent days"
          loading={facetsLoading}
          count={days.length}
          railItem={{ Icon: CalendarDays, active: !!filters.day }}
        >
          <SidebarMenu>
            {days.map((d) => (
              <SidebarMenuItem key={d.day}>
                <SidebarMenuButton
                  isActive={filters.day === d.day}
                  tooltip={withCount(formatDayLabel(d.day), d.count)}
                  onClick={() => select(filters.day === d.day ? {} : { day: d.day })}
                >
                  <CalendarDays aria-hidden />
                  <span>{formatDayLabel(d.day)}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{d.count}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </CollapsibleGroup>
      </SidebarContent>

      {/* shrink-0: the footer is a flex sibling of the scroll area, and without
          it a tall facet list compresses the footer and clips its last row. */}
      {/* The extension nudge moved to the dashboard's install card (2026-08-27,
          Tara: one nudge, not two) — the sidebar footer stays chrome-only. */}
      <SidebarFooter className="shrink-0 border-t">
        <SidebarMenu>
          {onOpenTour && (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Getting started" onClick={() => { onOpenTour(); setOpenMobile(false); }}>
                <Sparkles aria-hidden />
                <span>Getting started</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              onClick={() => {
                onOpenSettings?.();
                setOpenMobile(false);
              }}
            >
              <Settings aria-hidden />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarResizeHandle />
    </Sidebar>
  );
}

interface CollapsibleGroupProps {
  label: string;
  /** Facets not in yet → skeleton rows, section open. */
  loading: boolean;
  /** How many facet rows `children` will render. 0 once loaded ⇒ the whole
   * section is dropped (see below). */
  count: number;
  /**
   * On the icon rail, stand in for the WHOLE section with one icon that expands
   * the sidebar. For sections whose rows all share a glyph (every category is a
   * folder, every day a calendar) a rail of identical icons says nothing; one
   * icon that says "Categories" and opens them does. Sections whose rows have
   * distinct glyphs (browsers, devices) omit this and stay row-per-icon.
   */
  railItem?: { Icon: React.ElementType; active: boolean };
  children: React.ReactNode;
}

/**
 * A facet section that folds shut from its label (chevron flips with state).
 *
 * An empty section renders NOTHING: a dimmed, clickable header that opens onto a
 * sentence explaining what isn't there yet is four rows of furniture for a
 * brand-new account, and the first-run panel in the content area already teaches
 * where bookmarks come from.
 *
 * Controlled rather than `defaultOpen`: meta arrives AFTER mount, and Radix
 * reads `defaultOpen` once, so `defaultOpen={count > 0}` would latch to the
 * empty first render and never open. `userOpen` pins the user's own toggle so a
 * later data change can't yank a section shut under someone who just opened it.
 */
function CollapsibleGroup({ label, loading, count, railItem, children }: CollapsibleGroupProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const { state, isMobile, setOpen } = useSidebar();
  // While /api/meta is in flight the groups don't exist at all — four labelled
  // headers over skeleton bars read as broken empty dropdowns (owner feedback
  // on the landing loader), and the nav rows above are enough sidebar until
  // real facets arrive. Loading and empty therefore render the same: nothing.
  if (loading || count === 0) return null;
  const open = userOpen ?? true;

  // Rail stand-in (see `railItem`). Expanding from here goes through the
  // provider's controlled `open`, i.e. the layout store — so on a rail the dock
  // forced, this is the same "the user wants the sidebar back" as the header
  // trigger, and the dock floats to make room (rule 4 in lib/app-layout.ts).
  if (railItem && state === "collapsed" && !isMobile) {
    return (
      <>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={railItem.active}
                  tooltip={label}
                  aria-label={`${label} — expand sidebar`}
                  onClick={() => setOpen(true)}
                >
                  <railItem.Icon aria-hidden />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setUserOpen} className="group/collapsible">
      {/* Rail only: the label below folds away there (shadcn pulls it up under
          the previous rows at zero height), so a hairline is what separates one
          run of icons from the next. */}
      <SidebarSeparator className="hidden group-data-[collapsible=icon]:block" />
      <SidebarGroup>
        {/* pointer-events-none on the rail: the folded-away label still sits,
            invisible, over the bottom of the previous group's last row and would
            otherwise steal that row's clicks to toggle this section. */}
        <SidebarGroupLabel asChild className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11 group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:pointer-events-none">
          <CollapsibleTrigger className="group/section gap-2">
            <ChevronDown
              aria-hidden
              className="size-3.5 -rotate-90 opacity-0 transition-[opacity,transform] group-hover/section:opacity-100 group-focus-visible/section:opacity-100 group-data-[state=open]/collapsible:rotate-0 max-md:opacity-100 [@media(hover:none)]:opacity-100"
            />
            <span>{label}</span>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/** A fixed row's count: the number, a skeleton while it loads, nothing if it failed. */
function CountBadge({ value, loading }: { value?: number | null; loading?: boolean }) {
  if (value != null) return <SidebarMenuBadge>{value}</SidebarMenuBadge>;
  if (!loading) return null;
  return (
    <SidebarMenuBadge>
      <Skeleton className="h-3 w-4" />
    </SidebarMenuBadge>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
