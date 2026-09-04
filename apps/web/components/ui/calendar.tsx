"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A month grid with range selection, hand-written.
 *
 * Not react-day-picker: the only consumer is the library's Date filter, and a
 * range grid is ~120 lines of date math — not worth a dependency (plus its own
 * CSS/theming layer) in a bundle that ships to every page. Not `shadcn add
 * calendar` either: that CLI appends a duplicate copy of the theme tokens to
 * app/globals.css every time it runs, and brand tokens live ONLY in
 * packages/ui/src/theme.css (gotcha 3 in CLAUDE.md). Same house style as
 * segmented-control.tsx — plain buttons, theme tokens, no primitive library.
 *
 * All dates are LOCAL calendar days serialized as YYYY-MM-DD: the user is picking
 * days off a calendar they read in their own timezone, and the API treats a
 * date-only bound as that whole day.
 */

export interface CalendarRange {
  /** YYYY-MM-DD, either end optional. */
  from?: string;
  to?: string;
}

export interface CalendarProps {
  value: CalendarRange;
  /**
   * Fired on every day click. A click with no open selection (or with a complete
   * range) starts a new one — `{ from }` only; the next click completes it and
   * reports both ends, normalized so `from <= to`.
   */
  onSelect: (range: CalendarRange) => void;
  /** Latest selectable day, YYYY-MM-DD. Defaults to today — nothing is saved in
   * the future, so a later day could only ever match zero bookmarks. */
  max?: string;
  className?: string;
}

/** Local YYYY-MM-DD. Deliberately not toISOString(), which is UTC and lands on
 * the previous day for anyone west of Greenwich in the evening. */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Locale weekday initials, Sunday-first. 2024-09-01 was a Sunday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 8, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }),
);

/** The 6×7 block of days covering a month, starting on the Sunday on-or-before
 * the 1st. Always six weeks so the popover never changes height month to month. */
function monthWeeks(year: number, month: number): Date[][] {
  // Day-of-month arithmetic, not setDate on a Date that has already crossed into
  // the previous month: `new Date(y, m, 0)` and negatives roll over correctly, so
  // "the 1st minus however many days into the week it falls" needs no branching.
  const lead = new Date(year, month, 1).getDay();
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => new Date(year, month, 1 - lead + w * 7 + d)),
  );
}

export function Calendar({ value, onSelect, max, className }: CalendarProps) {
  const today = useMemo(() => ymd(new Date()), []);
  const maxDay = max ?? today;

  // Which month the grid shows. Seeded from the active range so re-opening the
  // popover on a March range doesn't start in the current month.
  const [view, setView] = useState(() => {
    const anchor = value.from ?? value.to;
    const d = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
    return Number.isNaN(d.getTime())
      ? { year: new Date().getFullYear(), month: new Date().getMonth() }
      : { year: d.getFullYear(), month: d.getMonth() };
  });
  // Jump to a range applied from outside (a preset, the URL, a Clear).
  useEffect(() => {
    if (!value.from) return;
    const d = new Date(`${value.from}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    setView({ year: d.getFullYear(), month: d.getMonth() });
  }, [value.from]);

  // Which day the pointer is over, so a half-picked range previews the span it
  // would cover — otherwise the first click looks like it did nothing.
  const [hovered, setHovered] = useState<string | null>(null);

  const weeks = useMemo(() => monthWeeks(view.year, view.month), [view]);
  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  // The span to paint: the applied range, or the open start plus whatever the
  // pointer is on (either order — dragging backwards previews too).
  const open = Boolean(value.from && !value.to);
  const previewEnd = open && hovered ? hovered : value.to;
  const [spanStart, spanEnd] =
    value.from && previewEnd && previewEnd < value.from
      ? [previewEnd, value.from]
      : [value.from, previewEnd];

  const pick = (day: string) => {
    // A complete range (or none) restarts; an open one closes, normalized.
    if (!value.from || value.to) {
      onSelect({ from: day });
    } else if (day < value.from) {
      onSelect({ from: day, to: value.from });
    } else {
      onSelect({ from: value.from, to: day });
    }
    setHovered(null);
  };

  const shift = (by: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  // Nothing to see past the max day's month.
  const nextDisabled = ymd(new Date(view.year, view.month + 1, 1)) > maxDay;

  return (
    <div className={cn("w-[15.5rem] select-none", className)}>
      <div className="flex items-center justify-between gap-1 pb-2">
        <NavButton label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" aria-hidden />
        </NavButton>
        {/* aria-live so a screen reader hears the month change the arrows made. */}
        <span aria-live="polite" className="text-sm font-medium">
          {monthLabel}
        </span>
        <NavButton label="Next month" onClick={() => shift(1)} disabled={nextDisabled}>
          <ChevronRight className="size-4" aria-hidden />
        </NavButton>
      </div>
      <div role="grid" aria-label="Choose a date range" className="flex flex-col gap-0.5">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((w, i) => (
            <span
              // Locale initials repeat (S, T), so the index is the only stable key.
              key={i}
              role="columnheader"
              className="pb-1 text-center text-[0.7rem] font-medium text-muted-foreground"
            >
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={ymd(week[0]!)} role="row" className="grid grid-cols-7 gap-0.5">
            {week.map((date) => {
              const day = ymd(date);
              const outside = date.getMonth() !== view.month;
              const disabled = day > maxDay;
              const isStart = day === spanStart;
              const isEnd = day === spanEnd;
              const inside = Boolean(spanStart && spanEnd && day > spanStart && day < spanEnd);
              const endpoint = isStart || isEnd;
              return (
                <div key={day} role="gridcell" aria-selected={endpoint || inside}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(day)}
                    onMouseEnter={() => setHovered(day)}
                    // Keyboard tabbing through the grid previews the same span.
                    onFocus={() => setHovered(day)}
                    aria-label={date.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                    aria-current={day === today ? "date" : undefined}
                    className={cn(
                      "flex h-8 w-full items-center justify-center rounded-md text-xs tabular-nums transition-colors",
                      disabled && "cursor-not-allowed text-muted-foreground/40",
                      !disabled && outside && "text-muted-foreground/60",
                      !disabled && !outside && "text-foreground",
                      !disabled && !endpoint && !inside && "hover:bg-muted",
                      inside && "bg-accent text-accent-foreground",
                      endpoint && "bg-primary font-medium text-primary-foreground",
                      // Today needs to stay findable even when it's in the span.
                      day === today && !endpoint && "font-semibold underline underline-offset-2",
                    )}
                  >
                    {date.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
