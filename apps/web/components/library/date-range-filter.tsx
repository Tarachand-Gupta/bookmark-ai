"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DateRangeFilterProps {
  /** YYYY-MM-DD, either end optional. */
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  className?: string;
}

function fmt(d?: string): string | null {
  if (!d) return null;
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A small, dependency-free date-range popover (two native date inputs). Applying
 * a range drives a server-side saved-day filter; while it's active the content
 * area drops date grouping and shows a flat, range-filtered list.
 */
export function DateRangeFilter({ from, to, onChange, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [localFrom, setLocalFrom] = useState(from ?? "");
  const [localTo, setLocalTo] = useState(to ?? "");
  const ref = useRef<HTMLDivElement>(null);

  // Reflect externally-applied ranges (e.g. from the URL) into the inputs.
  useEffect(() => {
    setLocalFrom(from ?? "");
    setLocalTo(to ?? "");
  }, [from, to]);

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
  const label = active ? [fmt(from), fmt(to)].filter(Boolean).join(" – ") || "Date range" : "Date";

  const apply = () => {
    let f = localFrom || undefined;
    let t = localTo || undefined;
    if (f && t && f > t) [f, t] = [t, f]; // tolerate reversed input
    onChange({ from: f, to: t });
    setOpen(false);
  };

  const clear = () => {
    setLocalFrom("");
    setLocalTo("");
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
          "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors",
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
            className="-mr-1 ml-0.5 inline-flex rounded p-0.5 hover:bg-background"
          >
            <X className="size-3.5" aria-hidden />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter by date range"
          className="absolute right-0 z-20 mt-2 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              From
              <input
                type="date"
                value={localFrom}
                max={localTo || undefined}
                onChange={(e) => setLocalFrom(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              To
              <input
                type="date"
                value={localTo}
                min={localFrom || undefined}
                onChange={(e) => setLocalTo(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={!active && !localFrom && !localTo}
            >
              Clear
            </Button>
            <Button type="button" size="sm" onClick={apply} disabled={!localFrom && !localTo}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
