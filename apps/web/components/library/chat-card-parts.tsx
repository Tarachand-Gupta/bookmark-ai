"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hostOf } from "@/lib/chat-tools";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the chat's GENERATIVE UI cards (live tabs, bookmark
 * hits, SQL tables, sessions). Every list-shaped tool result gets the same
 * behaviour — a toolbar with a substring filter, groups that collapse past a
 * threshold with a "show N more" row, and consistent hover/focus affordances —
 * so the cards read as one component family rather than four one-offs.
 */

/** Rows shown per group before the rest folds behind "show N more". */
export const COLLAPSED_ROWS = 8;

/** Case-insensitive substring filter over any list, memoized. */
export function useTextFilter<T>(items: readonly T[], haystack: (item: T) => string) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? items.filter((i) => haystack(i).toLowerCase().includes(q)) : items),
    // `haystack` is defined inline by callers; the filter only depends on the data + query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q],
  );
  return { query, setQuery, filtered, active: q.length > 0 };
}

/**
 * The card's header strip: a live filter box on the left, totals on the right.
 * Rendered only when there is enough data to be worth filtering.
 */
export function CardToolbar({
  query,
  onQuery,
  placeholder,
  summary,
}: {
  query: string;
  onQuery: (v: string) => void;
  placeholder: string;
  summary: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-muted/20 px-2.5 py-1.5">
      <div className="relative flex min-w-0 flex-1 items-center">
        <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          className="h-7 w-full rounded-md border bg-background pl-7 pr-7 text-xs shadow-xs outline-none transition-colors placeholder:text-muted-foreground hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear filter"
            title="Clear filter"
            className="absolute right-1.5 cursor-pointer rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{summary}</span>
    </div>
  );
}

/** "Show 44 more" / "Show less" — the per-group truncation control. */
export function ShowMoreRow({
  hidden,
  expanded,
  onToggle,
  noun,
  className,
}: {
  hidden: number;
  expanded: boolean;
  onToggle: () => void;
  noun: string;
  className?: string;
}) {
  if (hidden <= 0 && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "cursor-pointer inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} aria-hidden />
      {expanded ? "Show less" : `Show ${hidden} more ${hidden === 1 ? noun : `${noun}s`}`}
    </button>
  );
}

/** Local "expand this group" state, one hook per group. */
export function useExpandable(total: number, limit = COLLAPSED_ROWS) {
  const [expanded, setExpanded] = useState(false);
  return {
    expanded,
    toggle: () => setExpanded((e) => !e),
    visibleCount: expanded ? total : Math.min(total, limit),
    hidden: Math.max(0, total - limit),
  };
}

/** A tab's real favicon when the capture carried one, else the host's initial in
 * a muted dot. Broken icon URLs fall back silently. */
export function TabFavicon({ src, url }: { src?: string | null; url: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (hostOf(url).trim()[0] ?? "•").toUpperCase();
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden
        width={16}
        height={16}
        onError={() => setFailed(true)}
        className="mt-0.5 size-4 shrink-0 rounded-sm object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground"
    >
      {letter}
    </span>
  );
}

/** Copy a URL to the clipboard, with a selection-based fallback for webviews
 * where the async Clipboard API is permission-denied. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 cursor-pointer"
      aria-label={copied ? "Link copied" : "Copy link"}
      title="Copy link"
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-500" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}

/** One muted line — "No matches", "Live sharing is off", … */
export function CardNote({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}
