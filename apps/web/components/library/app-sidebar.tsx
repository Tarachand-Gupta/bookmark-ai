"use client";

import { useState } from "react";
import type { MetaResponse } from "@bookmark-ai/types";
import {
  Bookmark,
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryFilters } from "@/lib/api";
import { FEATURE_ICONS } from "./feature-icons";
import { ExtensionCard } from "./extension-cta";

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
  /** Opens the settings modal (owned by the page so other surfaces can open it). */
  onOpenSettings?: () => void;
  /** Reopens the first-run feature tour. */
  onOpenTour?: () => void;
}

/**
 * Facet navigation: categories (AI), source browsers, devices, recent days.
 * Selecting a facet swaps the whole filter (one facet active at a time keeps
 * the mental model simple); selecting it again clears it.
 */
export function AppSidebar({
  meta,
  metaLoading,
  filters,
  onFilterChange,
  homeActive,
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
}: AppSidebarProps) {
  const { setOpenMobile } = useSidebar();
  const [allCategories, setAllCategories] = useState(false);

  const select = (next: LibraryFilters) => {
    onFilterChange(next);
    setOpenMobile(false);
  };

  const noFilter = !filters.category && !filters.browser && !filters.device && !filters.day;
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
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bookmark className="size-4" aria-hidden />
          </div>
          <div className="grid min-w-0 flex-1 leading-tight">
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
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background shadow-sm transition-colors hover:bg-muted"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </SidebarHeader>

      {/* pb-2 reserves the gap the pinned footer's own padding doesn't cover, so
          the last facet row can be scrolled clear of Tour/Settings instead of
          ending up half-hidden behind them. */}
      <SidebarContent className="pb-2">
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
                  isActive={!homeActive && noFilter && !sessionsActive && !liveActive}
                  onClick={() => select({})}
                >
                  <FEATURE_ICONS.bookmarks aria-hidden />
                  <span>All bookmarks</span>
                </SidebarMenuButton>
                <CountBadge value={meta?.total} loading={facetsLoading} />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!!liveActive}
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

        <CollapsibleGroup
          label="Categories"
          loading={facetsLoading}
          count={categories.length}
        >
          <SidebarMenu>
            {visibleCategories.map((c) => (
              <SidebarMenuItem key={c.name}>
                <SidebarMenuButton
                  isActive={filters.category === c.name}
                  onClick={() => select(filters.category === c.name ? {} : { category: c.name })}
                >
                  <Folder aria-hidden />
                  <span>{c.name}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{c.count}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
            {categories.length > VISIBLE_CATEGORIES && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setAllCategories((v) => !v)}
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
        >
          <SidebarMenu>
            {days.map((d) => (
              <SidebarMenuItem key={d.day}>
                <SidebarMenuButton
                  isActive={filters.day === d.day}
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
      <SidebarFooter className="shrink-0 border-t">
        <ExtensionCard />
        <SidebarMenu>
          {onOpenTour && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenTour}>
                <Sparkles aria-hidden />
                <span>Tour</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => onOpenSettings?.()}>
              <Settings aria-hidden />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
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
function CollapsibleGroup({ label, loading, count, children }: CollapsibleGroupProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  if (!loading && count === 0) return null;
  const open = userOpen ?? true;

  return (
    <Collapsible open={open} onOpenChange={setUserOpen} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            <span>{label}</span>
            <ChevronDown
              aria-hidden
              className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-180"
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{loading ? <FacetSkeleton /> : children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/** Varied bar widths so the placeholder reads as a list, not a barcode. */
const FACET_SKELETON_WIDTHS = ["72%", "56%", "84%", "63%"];

/**
 * Placeholder rows while /api/meta is in flight — loading must not look empty.
 *
 * Deliberately NOT shadcn's <SidebarMenuSkeleton>, which picks its bar width
 * with Math.random() at render: meta.loading starts true, so these DO render on
 * the server, and the client then rolls different numbers — a hydration
 * mismatch React logs and explicitly "won't patch up". Same markup, fixed widths.
 */
function FacetSkeleton() {
  return (
    <SidebarMenu>
      {FACET_SKELETON_WIDTHS.map((width) => (
        <SidebarMenuItem key={width}>
          <div className="flex h-8 items-center gap-2 rounded-md px-2">
            <Skeleton className="size-4 shrink-0 rounded-md" />
            <Skeleton className="h-4 flex-1" style={{ maxWidth: width }} />
          </div>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
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
