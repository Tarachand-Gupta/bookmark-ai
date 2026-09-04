"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The Ongoing view's filter field. Deliberately NOT the library header's search
 * box: that one queries the server for saved bookmarks and sessions, this one
 * only narrows the live snapshot already on screen (see `lib/live-filter.ts`),
 * so it sits with the content it filters and says "filter", not "search".
 *
 * Same visual pattern as the header field (leading icon, inline clear button)
 * so the two read as one family.
 */
export function LiveTabSearch({
  value,
  onChange,
  matchCount,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Matching tabs across every visible device — shown only while filtering. */
  matchCount: number;
}) {
  const active = value.trim().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="relative w-full sm:w-80">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filter open tabs…"
          className={cn("h-9 pl-8", value ? "pr-8" : "pr-3")}
          aria-label="Filter open tabs"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear tab filter"
            className="cursor-pointer absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {active && (
        // Polite, not assertive: the count changes on every keystroke, and a
        // screen reader should hear the result, not race it.
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {matchCount} matching tab{matchCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
