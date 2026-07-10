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
  Laptop,
  Layers,
  Library,
  Monitor,
  Plus,
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
import type { LibraryFilters } from "@/lib/api";

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
  aiEnabled: boolean | null;
  filters: LibraryFilters;
  onFilterChange: (filters: LibraryFilters) => void;
  /** Whether the Sessions view (not the library) is showing. */
  sessionsActive?: boolean;
  sessionCount?: number | null;
  onShowSessions?: () => void;
  /** Opens the add-bookmark dialog (the + next to the branding). */
  onAdd?: () => void;
}

/**
 * Facet navigation: categories (AI), source browsers, devices, recent days.
 * Selecting a facet swaps the whole filter (one facet active at a time keeps
 * the mental model simple); selecting it again clears it.
 */
export function AppSidebar({
  meta,
  aiEnabled,
  filters,
  onFilterChange,
  sessionsActive,
  sessionCount,
  onShowSessions,
  onAdd,
}: AppSidebarProps) {
  const { setOpenMobile } = useSidebar();
  const [allCategories, setAllCategories] = useState(false);

  const select = (next: LibraryFilters) => {
    onFilterChange(next);
    setOpenMobile(false);
  };

  const noFilter = !filters.category && !filters.browser && !filters.device && !filters.day;
  const categories = meta?.categories ?? [];
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

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={noFilter && !sessionsActive}
                  onClick={() => select({})}
                >
                  <Library aria-hidden />
                  <span>All bookmarks</span>
                </SidebarMenuButton>
                {meta ? <SidebarMenuBadge>{meta.total}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!!sessionsActive}
                  onClick={() => {
                    onShowSessions?.();
                    setOpenMobile(false);
                  }}
                >
                  <Layers aria-hidden />
                  <span>Sessions</span>
                </SidebarMenuButton>
                {sessionCount != null ? <SidebarMenuBadge>{sessionCount}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <CollapsibleGroup label="Categories">
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
            {meta && categories.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Save your first bookmark to see AI categories.
              </p>
            ) : null}
          </SidebarMenu>
        </CollapsibleGroup>

        <CollapsibleGroup label="Browsers">
          <SidebarMenu>
            {(meta?.browsers ?? []).map((b) => {
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

        <CollapsibleGroup label="Devices">
          <SidebarMenu>
            {(meta?.devices ?? []).map((d) => {
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

        <CollapsibleGroup label="Recent days">
          <SidebarMenu>
            {(meta?.days ?? []).slice(0, 7).map((d) => (
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

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          {aiEnabled === null
            ? "Connecting…"
            : aiEnabled
              ? "AI organization on"
              : "AI off — heuristics"}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/** A facet section that folds shut from its label (chevron flips with state). */
function CollapsibleGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            {label}
            <ChevronDown
              aria-hidden
              className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-180"
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
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
