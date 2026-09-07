"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, Search, X } from "lucide-react";
import { describePageRange, type ToolPageMeta } from "@bookmark-ai/types";
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
export const COLLAPSED_ROWS = 10;
/** How many more rows one "show more" click reveals — a 92-tab window opens in
 * readable chunks instead of dumping everything into the thread at once. */
export const EXPAND_CHUNK = 25;

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
  nextChunk,
  className,
}: {
  hidden: number;
  expanded: boolean;
  onToggle: () => void;
  noun: string;
  /** How many the next click reveals; defaults to all of `hidden`. */
  nextChunk?: number;
  className?: string;
}) {
  if (hidden <= 0 && !expanded) return null;
  const step = Math.min(nextChunk ?? hidden, hidden);
  const label =
    hidden === 0
      ? "Show less"
      : step < hidden
        ? `Show ${step} more (${hidden} left)`
        : `Show ${hidden} more ${hidden === 1 ? noun : `${noun}s`}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "cursor-pointer inline-flex items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ChevronDown className={cn("size-3 transition-transform", hidden === 0 && "rotate-180")} aria-hidden />
      {label}
    </button>
  );
}

/**
 * Local "expand this group" state. Starts at `limit` rows and grows by
 * `EXPAND_CHUNK` per click, so a very long group opens in readable steps rather
 * than all at once; "Show less" snaps back to the start.
 */
export function useExpandable(total: number, limit = COLLAPSED_ROWS, chunk = EXPAND_CHUNK) {
  const [shown, setShown] = useState(limit);
  const visibleCount = Math.min(total, shown);
  const hidden = Math.max(0, total - visibleCount);
  return {
    expanded: visibleCount > limit,
    visibleCount,
    hidden,
    /** Reveal the next chunk (or collapse when everything is already shown). */
    toggle: () => setShown((n) => (n >= total ? limit : Math.min(total, n + chunk))),
    /** How many the next click reveals — the button says so. */
    nextChunk: Math.min(chunk, hidden),
  };
}

/**
 * "Load more" for a PAGE of tool results: the card fetches the next page from
 * the same HTTP route the tool used, with NO model turn. `fetchPage` returns the
 * rows plus the new page meta; rows accumulate in the card.
 */
export function useToolPaging<T>(
  initialRows: readonly T[],
  initialPage: ToolPageMeta | undefined,
  fetchPage: (offset: number, limit: number) => Promise<{ rows: T[]; page: ToolPageMeta }>,
) {
  const [rows, setRows] = useState<T[]>([...initialRows]);
  const [page, setPage] = useState<ToolPageMeta | undefined>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!page?.hasMore || page.nextOffset === null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPage(page.nextOffset, page.limit);
      setRows((prev) => [...prev, ...next.rows]);
      setPage(next.page);
    } catch (err) {
      setError((err as Error).message || "Could not load more.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loading, page]);

  return { rows, page, loading, error, loadMore, canLoadMore: page?.hasMore === true };
}

/**
 * The card's page footer: which rows this card is showing out of how many, and
 * the control that fetches the next page. Rendered only when there IS a next
 * page or a total worth stating.
 */
export function PageFooter({
  page,
  firstOffset,
  shown,
  noun,
  loading,
  error,
  onLoadMore,
}: {
  /** The LATEST page meta (after any "load more"). */
  page: ToolPageMeta | undefined;
  /** Offset of the FIRST page this card holds — the tool's own `offset`. */
  firstOffset: number;
  /** Rows accumulated in the card. */
  shown: number;
  noun: string;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
}) {
  if (!page) return null;
  const more = page.hasMore;
  // Nothing worth saying when the card holds the whole, first, complete result.
  if (!more && firstOffset === 0 && !error) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-2.5 py-1.5">
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {noun} {describePageRange({ ...page, offset: firstOffset }, shown)}
      </span>
      {more && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="cursor-pointer inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted disabled:cursor-progress disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {loading && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {loading ? "Loading…" : `Load next ${page.limit}`}
        </button>
      )}
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
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
