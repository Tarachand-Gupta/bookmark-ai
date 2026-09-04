"use client";

import { useState } from "react";
import type { MetaResponse } from "@bookmark-ai/types";
import {
  CalendarDays,
  CheckSquare,
  Chrome,
  Compass,
  Flame,
  Folder,
  Globe,
  Laptop,
  Monitor,
  Smartphone,
  SlidersHorizontal,
  Tablet,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { LibraryFilters } from "@/lib/api";
import { formatRangeLabel } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import { DateRangeFilter } from "./date-range-filter";
import { ViewMenu, type LibraryView } from "./view-toggle";

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

/** Recent-days rows offered in the drawer — same window as the sidebar's facet. */
const VISIBLE_DAYS = 7;

/**
 * 44px — the minimum comfortable touch target, applied to every control on this
 * (phone-only) surface. The shared Button's `sm` size is 32px tall, which is a
 * pointer size; here it's the primary way to filter the library.
 */
const TOUCH_TARGET = "h-11";

/**
 * The dismissible active-filter chips read as annotations, so growing them to a
 * full 44px would shout. Instead the 36px pill carries an invisible ::after that
 * extends the hit area to 44px vertically — sized to exactly meet (never overlap)
 * the 8px row gap when the chips wrap onto two lines.
 */
const CHIP_TOUCH =
  "relative h-9 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";

/**
 * Container-query threshold (see the `@container` comment on the control row)
 * below which the Filters/Tags/Select buttons drop their text and become
 * icon-only. The labels come off only when they genuinely stop fitting, so the
 * number is measured, not guessed — at the app's own type scale the fully
 * labeled row in its WIDEST realistic state measures (Chrome, default 16px root):
 *
 *   Filters+badge 104.8 + Tags+badge 95.1 + Select 85.6 + view trigger 58
 *   + 3 × 8px gap = 367.6px
 *
 * (badges are always single-digit: the facet filters are mutually exclusive, so
 * filterCount tops out at 2 — one facet + a date range — and tagCount at 1.)
 * 24rem = 384px is that width plus ~16px of slack. Reserving for the widest
 * state, not the current one, is deliberate: keying the threshold off whether a
 * badge happens to be showing would make every label vanish the moment you
 * applied a filter. Unlabeled the same row is 327.6px, so nothing overflows
 * below the threshold either.
 *
 * Container width, NOT viewport: `main` insets this row by p-3/p-4 and the
 * sidebar insets it again on tablets, so a 430px phone only offers 406px here
 * and a viewport-keyed breakpoint of the same number collapses too early —
 * which is the bug this replaced (26rem/416px hid the labels on every phone).
 * In rem so the threshold scales with the root font size the labels do.
 */
const LABEL_VISIBLE = "hidden @min-[24rem]:inline";

export interface MobileFilterBarProps {
  meta: MetaResponse | null;
  filters: LibraryFilters;
  onFilterChange: (next: LibraryFilters) => void;
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  /** Turn touch selection mode on/off (Part B). Omit to hide the button. */
  onSelectMode?: (on: boolean) => void;
  selectionActive?: boolean;
  className?: string;
}

/**
 * The <md replacement for the desktop tag rail + date-range control.
 *
 * On a phone the rail was a sideways-scrolling strip of tiny chips with the view
 * toggle crowding its right edge, and the sidebar (the only other way to filter)
 * is behind a hamburger — so filtering meant opening a navigation drawer, which
 * is a different job. This is a compact control row instead: two buttons with
 * active-count badges, each opening a bottom drawer of tappable chips, plus the
 * active filters as dismissible chips underneath.
 *
 * Sheet(side="bottom") rather than a vaul drawer: the sheet primitive is already
 * in this app (the sidebar's own mobile mode uses it), it slides from the bottom
 * edge with the same spring, and adding a second overlay library for a swipe
 * handle isn't worth a dependency. No drag-to-dismiss as a result — tap outside
 * or the × closes it.
 *
 * Filter semantics: category/browser/device/day stay mutually exclusive, exactly
 * as in the sidebar (picking one replaces the others). Tags and the date range
 * are orthogonal and survive a facet change — the drawer presents them together,
 * so silently dropping one while the user taps another would be a trap. The API
 * accepts every combination.
 */
export function MobileFilterBar({
  meta,
  filters,
  onFilterChange,
  view,
  onViewChange,
  onSelectMode,
  selectionActive,
  className,
}: MobileFilterBarProps) {
  const [openDrawer, setOpenDrawer] = useState<"filters" | "tags" | null>(null);

  const categories = meta?.categories ?? [];
  const browsers = meta?.browsers ?? [];
  const devices = meta?.devices ?? [];
  const days = (meta?.days ?? []).slice(0, VISIBLE_DAYS);
  const tags = meta?.tags ?? [];

  const filterCount =
    (filters.category ? 1 : 0) +
    (filters.browser ? 1 : 0) +
    (filters.device ? 1 : 0) +
    (filters.day ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0);
  const tagCount = filters.tag ? 1 : 0;

  /** Mutually-exclusive facet pick; tag + date range ride along unchanged. */
  const pickFacet = (key: "category" | "browser" | "device" | "day", value: string) => {
    const base: LibraryFilters = { tag: filters.tag, from: filters.from, to: filters.to };
    onFilterChange(filters[key] === value ? base : { ...base, [key]: value });
  };

  const pickTag = (tag: string) => {
    onFilterChange({ ...filters, tag: filters.tag === tag ? undefined : tag });
  };

  const clearOne = (keys: (keyof LibraryFilters)[]) => {
    const next = { ...filters };
    for (const key of keys) delete next[key];
    onFilterChange(next);
  };

  const active = activeChips(filters);

  return (
    <div className={cn("flex flex-col gap-2 @container", className)}>
      {/* `@container` above (not a viewport breakpoint) because this bar sits
          inside a main that the sidebar insets — viewport width overstates the
          room this row actually has. flex-nowrap, not flex-wrap: wrapping used
          to be how this row avoided overflowing on narrow phones, but it broke
          the view switcher onto its own line, which is worse than the overflow
          it was avoiding. Now nothing here wraps — the buttons drop their text
          (LABEL_VISIBLE, icon + badge survive) below the measured threshold on
          that constant, and the view switcher is a single dropdown button
          instead of three segments, so the row's natural width never gets close
          to overflowing at any phone size. */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        <Button
          variant={filterCount ? "secondary" : "outline"}
          size="sm"
          className={TOUCH_TARGET}
          onClick={() => setOpenDrawer("filters")}
          aria-label="Filters"
          title="Filters"
        >
          <SlidersHorizontal aria-hidden />
          <span className={LABEL_VISIBLE}>Filters</span>
          {filterCount > 0 && <CountPill>{filterCount}</CountPill>}
        </Button>
        {tags.length > 0 && (
          <Button
            variant={tagCount ? "secondary" : "outline"}
            size="sm"
            className={TOUCH_TARGET}
            onClick={() => setOpenDrawer("tags")}
            aria-label="Tags"
            title="Tags"
          >
            <Tag aria-hidden />
            <span className={LABEL_VISIBLE}>Tags</span>
            {tagCount > 0 && <CountPill>{tagCount}</CountPill>}
          </Button>
        )}
        {onSelectMode && (
          // Touch can't hover a row to reveal its checkbox, so selection mode
          // needs its own entry point — and its own way out, since the floating
          // bar only exists once something is actually ticked.
          <Button
            variant={selectionActive ? "secondary" : "outline"}
            size="sm"
            className={TOUCH_TARGET}
            onClick={() => onSelectMode(!selectionActive)}
            aria-pressed={selectionActive}
            aria-label={selectionActive ? "Done selecting" : "Select"}
            title={selectionActive ? "Done selecting" : "Select"}
          >
            <CheckSquare aria-hidden />
            <span className={LABEL_VISIBLE}>{selectionActive ? "Done" : "Select"}</span>
          </Button>
        )}
        {/* A single dropdown button, not the desktop's three-segment ViewToggle:
            three squares plus their own touch targets is exactly the chrome that
            forced this row to wrap in the first place. `ViewMenu` (view-toggle.tsx)
            shares the same VIEWS table as ViewToggle, so the two surfaces can't
            drift on labels/icons even though they render differently. */}
        <ViewMenu view={view} onChange={onViewChange} className="ml-auto" />
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => clearOne(chip.keys)}
              className={cn(
                "cursor-pointer inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium",
                CHIP_TOUCH,
              )}
            >
              <chip.Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{chip.label}</span>
              <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          {active.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className={cn("px-2 text-xs text-muted-foreground", CHIP_TOUCH)}
              onClick={() => onFilterChange({})}
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      <FilterDrawer
        open={openDrawer !== null}
        title={openDrawer === "tags" ? "Tags" : "Filters"}
        description={
          openDrawer === "tags"
            ? "Filter the library by one of the tags the AI applied."
            : "Filter the library by category, source, device or date."
        }
        onOpenChange={(next) => setOpenDrawer(next ? openDrawer : null)}
        active={active}
        onClearOne={clearOne}
        onClearAll={() => onFilterChange({})}
      >
        {openDrawer === "tags" ? (
          <ChipSection title="Tags">
            {tags.map((t) => (
              <FacetChip
                key={t.name}
                label={t.name}
                count={t.count}
                Icon={Tag}
                active={filters.tag === t.name}
                onClick={() => pickTag(t.name)}
              />
            ))}
          </ChipSection>
        ) : (
          <>
            {/* First, deliberately: its popover opens downward inside this
                scrolling drawer, so it needs the room below it. */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Date range
              </h3>
              <DateRangeFilter
                from={filters.from}
                to={filters.to}
                onChange={({ from, to }) => onFilterChange({ ...filters, from, to })}
              />
            </div>
            {categories.length > 0 && (
              <ChipSection title="Categories">
                {categories.map((c) => (
                  <FacetChip
                    key={c.name}
                    label={c.name}
                    count={c.count}
                    Icon={Folder}
                    active={filters.category === c.name}
                    onClick={() => pickFacet("category", c.name)}
                  />
                ))}
              </ChipSection>
            )}
            {browsers.length > 0 && (
              <ChipSection title="Browsers">
                {browsers.map((b) => (
                  <FacetChip
                    key={b.name}
                    label={b.name}
                    count={b.count}
                    Icon={BROWSER_ICONS[b.name] ?? Globe}
                    active={filters.browser === b.name}
                    capitalize
                    onClick={() => pickFacet("browser", b.name)}
                  />
                ))}
              </ChipSection>
            )}
            {devices.length > 0 && (
              <ChipSection title="Devices">
                {devices.map((d) => (
                  <FacetChip
                    key={d.name}
                    label={d.name}
                    count={d.count}
                    Icon={DEVICE_ICONS[d.name] ?? Monitor}
                    active={filters.device === d.name}
                    capitalize
                    onClick={() => pickFacet("device", d.name)}
                  />
                ))}
              </ChipSection>
            )}
            {days.length > 0 && (
              <ChipSection title="Recent days">
                {days.map((d) => (
                  <FacetChip
                    key={d.day}
                    label={formatDayLabel(d.day)}
                    count={d.count}
                    Icon={CalendarDays}
                    active={filters.day === d.day}
                    onClick={() => pickFacet("day", d.day)}
                  />
                ))}
              </ChipSection>
            )}
            {categories.length === 0 &&
              browsers.length === 0 &&
              devices.length === 0 &&
              days.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing to filter by yet — save a few bookmarks and the categories, browsers and
                  devices they came from show up here.
                </p>
              )}
          </>
        )}
      </FilterDrawer>
    </div>
  );
}

/** The count badge inside the Filters/Tags buttons. */
function CountPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
      {children}
    </span>
  );
}

interface ActiveChip {
  label: string;
  Icon: React.ElementType;
  /** Filter keys this chip's × removes (the date range owns two). */
  keys: (keyof LibraryFilters)[];
}

/** Every applied filter as one dismissible chip, in the drawer's own order. */
function activeChips(filters: LibraryFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (filters.category) chips.push({ label: filters.category, Icon: Folder, keys: ["category"] });
  if (filters.browser) {
    chips.push({
      // Facet values are stored lowercase; the chip is prose, so capitalize here
      // rather than relying on a CSS class two components away.
      label: capitalize(filters.browser),
      Icon: BROWSER_ICONS[filters.browser] ?? Globe,
      keys: ["browser"],
    });
  }
  if (filters.device) {
    chips.push({
      label: capitalize(filters.device),
      Icon: DEVICE_ICONS[filters.device] ?? Monitor,
      keys: ["device"],
    });
  }
  if (filters.day) {
    chips.push({ label: formatDayLabel(filters.day), Icon: CalendarDays, keys: ["day"] });
  }
  if (filters.from || filters.to) {
    chips.push({
      // Formatted, not the raw bounds: a preset writes a full ISO datetime, and
      // "2026-08-11T09:14:03.221Z – " is not a filter chip.
      label: formatRangeLabel(filters.from, filters.to),
      Icon: CalendarDays,
      keys: ["from", "to"],
    });
  }
  if (filters.tag) chips.push({ label: `#${filters.tag}`, Icon: Tag, keys: ["tag"] });
  return chips;
}

function FilterDrawer({
  open,
  title,
  description,
  onOpenChange,
  active,
  onClearOne,
  onClearAll,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
  active: ActiveChip[];
  onClearOne: (keys: (keyof LibraryFilters)[]) => void;
  onClearAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // svh, not vh: mobile Safari's vh includes the retracting toolbar, which
        // pushed the last chip row under it.
        className="max-h-[85svh] gap-0 rounded-t-2xl"
        // The sheet's built-in × is a bare 16px icon — a pointer-sized target on
        // the one surface that is only ever touched. Replaced below.
        showCloseButton={false}
      >
        <SheetHeader className="shrink-0 flex-row items-center gap-2 pb-2">
          <SheetTitle className="min-w-0 flex-1">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
          <SheetClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 size-11 shrink-0 text-muted-foreground"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden />
            </Button>
          </SheetClose>
        </SheetHeader>
        {active.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 pb-3">
            <span className="text-xs font-medium text-muted-foreground">Active</span>
            {active.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => onClearOne(chip.keys)}
                className={cn(
                  "cursor-pointer inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium",
                  CHIP_TOUCH,
                )}
              >
                <span className="truncate">{chip.label}</span>
                <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">Remove filter</span>
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className={cn("ml-auto px-2 text-xs text-muted-foreground", CHIP_TOUCH)}
              onClick={onClearAll}
            >
              Clear all
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChipSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FacetChip({
  label,
  count,
  Icon,
  active,
  capitalize,
  onClick,
}: {
  label: string;
  count: number;
  Icon: React.ElementType;
  active: boolean;
  capitalize?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      // h-9: a 28px chip is under every touch-target guideline, and these are the
      // primary controls on this breakpoint.
      className={cn(
        "cursor-pointer inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-background text-foreground",
      )}
    >
      <Icon
        className={cn("size-3.5 shrink-0", active ? "opacity-80" : "text-muted-foreground")}
        aria-hidden
      />
      <span className={cn("truncate", capitalize && "capitalize")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          active ? "text-primary-foreground/70" : "text-muted-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
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
