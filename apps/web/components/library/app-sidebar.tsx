"use client";

import type { MetaResponse } from "@bookmark-ai/types";
import {
  Bookmark,
  CalendarDays,
  Chrome,
  Compass,
  Flame,
  Folder,
  Globe,
  Laptop,
  Library,
  Monitor,
  Smartphone,
  Sparkles,
  Tablet,
} from "lucide-react";
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
}

/**
 * Facet navigation: categories (AI), source browsers, devices, recent days.
 * Selecting a facet swaps the whole filter (one facet active at a time keeps
 * the mental model simple); selecting it again clears it.
 */
export function AppSidebar({ meta, aiEnabled, filters, onFilterChange }: AppSidebarProps) {
  const { setOpenMobile } = useSidebar();

  const select = (next: LibraryFilters) => {
    onFilterChange(next);
    setOpenMobile(false);
  };

  const noFilter = !filters.category && !filters.browser && !filters.device && !filters.day;

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bookmark className="size-4" aria-hidden />
          </div>
          <div className="grid leading-tight">
            <span className="font-semibold">Bookmark AI</span>
            <span className="text-xs text-muted-foreground">
              {meta ? `${meta.total} saved` : "—"}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={noFilter} onClick={() => select({})}>
                  <Library aria-hidden />
                  <span>All bookmarks</span>
                </SidebarMenuButton>
                {meta ? <SidebarMenuBadge>{meta.total}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Categories</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(meta?.categories ?? []).map((c) => (
                <SidebarMenuItem key={c.name}>
                  <SidebarMenuButton
                    isActive={filters.category === c.name}
                    onClick={() =>
                      select(filters.category === c.name ? {} : { category: c.name })
                    }
                  >
                    <Folder aria-hidden />
                    <span>{c.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{c.count}</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
              {meta && meta.categories.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Save your first bookmark to see AI categories.
                </p>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Browsers</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(meta?.browsers ?? []).map((b) => {
                const Icon = BROWSER_ICONS[b.name] ?? Globe;
                return (
                  <SidebarMenuItem key={b.name}>
                    <SidebarMenuButton
                      isActive={filters.browser === b.name}
                      onClick={() =>
                        select(filters.browser === b.name ? {} : { browser: b.name })
                      }
                    >
                      <Icon aria-hidden />
                      <span className="capitalize">{b.name}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>{b.count}</SidebarMenuBadge>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Devices</SidebarGroupLabel>
          <SidebarGroupContent>
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
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Recent days</SidebarGroupLabel>
          <SidebarGroupContent>
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
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          {aiEnabled === null ? "Connecting…" : aiEnabled ? "AI organization on" : "AI off — heuristics"}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
