"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar, type CalendarRange as DayRange } from "@/components/ui/calendar";
import { DATE_RANGE_PRESETS, formatRangeLabel, isDateOnly } from "@/lib/date-range";
import { cn } from "@/lib/utils";

export interface DateRangeFilterProps {
  /** Either a whole-day YYYY-MM-DD or a full ISO datetime; either end optional. */
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  className?: string;
}

/**
 * The library's Date control: a popover holding a range calendar plus a rail of
 * quick windows. Applying a range drives a server-side saved-at filter; while
 * it's active the content area drops date grouping and shows a flat, filtered
 * list.
 *
 * Clicking the trigger opens straight onto the calendar — the two native date
 * inputs this replaced made picking "last week" a four-interaction chore, and
 * neither could express a sub-day window at all. The presets set an ISO datetime
 * `from` with an open `to` ("up to now"), which is why the API/DB bounds accept
 * datetimes as well as days (see lib/date-range.ts).
 *
 * Also rendered inside the <md filter sheet (mobile-filter-bar.tsx), which is why
 * the popover opens leftward only from sm up and stacks the presets under the
 * calendar below it — a side-by-side 27rem panel doesn't fit a 390px screen, and
 * `right-0` off a left-aligned trigger would hang off the left edge.
 */
export function DateRangeFilter({ from, to, onChange, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Half-picked calendar state: the first click only stages a start (nothing is
  // applied until the range is complete, so the grid doesn't refetch mid-pick).
  const [draft, setDraft] = useState<DayRange | null>(null);
  // Which preset produced the active range, purely so the trigger can say "Last
  // hour" instead of an instant. Held in state rather than recomputed from `from`
  // because the presets are relative to now — a recomputed value never matches
  // the one applied a minute ago.
  const [preset, setPreset] = useState<{ label: string; from: string } | null>(null);

  // An externally-applied range (URL/back button/Clear) invalidates both.
  useEffect(() => {
    setDraft(null);
    setPreset((p) => (p && p.from === from && !to ? p : null));
  }, [from, to]);

  // Closing abandons a half-picked range — a staged start that survived until the
  // next open would silently pair with a click made minutes later.
  useEffect(() => {
    if (!open) setDraft(null);
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = Boolean(from || to);
  const label = !active
    ? "Date"
    : preset && preset.from === from && !to
      ? preset.label
      : formatRangeLabel(from, to);

  // The calendar only speaks whole days, so a datetime bound (from a preset)
  // shows as no selection rather than snapping to a day it doesn't mean.
  const calendarValue = useMemo<DayRange>(
    () =>
      draft ?? {
        from: from && isDateOnly(from) ? from : undefined,
        to: to && isDateOnly(to) ? to : undefined,
      },
    [draft, from, to],
  );

  const pickDays = (range: DayRange) => {
    if (range.from && range.to) {
      setDraft(null);
      setPreset(null);
      onChange({ from: range.from, to: range.to });
      setOpen(false);
    } else {
      setDraft(range); // start staged; waiting for the end
    }
  };

  const applyPreset = (p: (typeof DATE_RANGE_PRESETS)[number]) => {
    const value = p.from(new Date());
    setDraft(null);
    setPreset({ label: p.label, from: value });
    onChange({ from: value, to: undefined });
    setOpen(false);
  };

  const clear = () => {
    setDraft(null);
    setPreset(null);
    onChange({ from: undefined, to: undefined });
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "cursor-pointer inline-flex h-9 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors",
          active
            ? "border-primary/40 bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <CalendarRange className="size-4 shrink-0" aria-hidden />
        <span className="max-w-[13rem] truncate">{label}</span>
        {active && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date range"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                clear();
              }
            }}
            className="-mr-1 ml-0.5 inline-flex shrink-0 rounded p-0.5 hover:bg-background"
          >
            <X className="size-3.5" aria-hidden />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter by date range"
          // left-0 below sm (the sheet's trigger sits at the left edge, so a
          // right-anchored panel would hang off-screen), right-anchored above it
          // where the control lives at the right end of the toolbar row.
          // Underscores are Tailwind's spaces — `calc(100vw-2rem)` is invalid CSS
          // (calc needs whitespace around the minus).
          className="absolute left-0 z-20 mt-2 flex w-max max-w-[calc(100vw_-_2rem)] flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md sm:left-auto sm:right-0 sm:flex-row sm:gap-3"
        >
          <div className="flex flex-col gap-2">
            <Calendar value={calendarValue} onSelect={pickDays} />
            <div className="flex items-center justify-between gap-2 border-t pt-2">
              <span className="text-xs text-muted-foreground">
                {draft?.from ? "Pick an end date" : "Pick a start date"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clear}
                // Also the way out of a half-picked range, not just of an applied one.
                disabled={!active && !draft?.from}
              >
                Clear
              </Button>
            </div>
          </div>
          {/* Below sm this wraps into a two-column block under the calendar; from
              sm up it's the scrollable rail on the right. max-h caps it at the
              calendar's own height so the popover never grows past it. */}
          <div
            role="group"
            aria-label="Quick ranges"
            className="grid grid-cols-2 gap-1 border-t pt-2 sm:flex sm:max-h-[17rem] sm:w-32 sm:flex-col sm:overflow-y-auto sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0"
          >
            {DATE_RANGE_PRESETS.map((p) => {
              // "Applied" means the range in the URL is still the one THIS preset
              // wrote — not just that its label matches.
              const applied = preset?.label === p.label && preset.from === from && !to;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  aria-pressed={applied}
                  className={cn(
                    "cursor-pointer shrink-0 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors",
                    applied
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
