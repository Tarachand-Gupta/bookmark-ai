"use client";

import { useCallback } from "react";
import { ExternalLink, Folder, Globe } from "lucide-react";
import { pageSearchResponse, type SearchMode } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import { searchBookmarksPage, type LibraryFilters } from "@/lib/api";
import { hostOf } from "@/lib/chat-tools";
import { safeHref } from "@/lib/safe-href";
import {
  CardNote,
  CardToolbar,
  CopyLinkButton,
  PageFooter,
  ShowMoreRow,
  useExpandable,
  useTextFilter,
  useToolPaging,
} from "./chat-card-parts";
import type { BookmarkHit, SearchToolOutput, ToolPageMeta } from "./chat-tool-types";

/**
 * `searchBookmarks` as a card: ONE PAGE of hits with their category/tag chips
 * (click to filter the library), a substring filter over what's loaded, and a
 * "Load next 50" that re-runs the same search against /api/search — no model
 * turn. The model reads the same page verbatim, so the card and the answer can
 * never disagree about what was found.
 */
export function BookmarksCard({
  output,
  onFilter,
}: {
  output: SearchToolOutput;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  const q = output.query ?? "";
  const mode = (output.mode === "ai" ? "ai" : output.mode) as SearchMode;
  const fetchPage = useCallback(
    async (offset: number, limit: number): Promise<{ rows: BookmarkHit[]; page: ToolPageMeta }> => {
      const res = await searchBookmarksPage(q, mode, { limit, offset });
      return pageSearchResponse(res.results, res.hasMore, offset, limit);
    },
    [q, mode],
  );
  return (
    <BookmarkHits
      hits={output.results ?? []}
      page={output.page}
      // Without an echoed query there is nothing to re-run (a turn stored before
      // paging shipped) — the card stays a plain list.
      fetchPage={q ? fetchPage : undefined}
      showScore={output.mode === "ai"}
      onFilter={onFilter}
    />
  );
}

export function BookmarkHits({
  hits,
  page: initialPage,
  fetchPage,
  showScore,
  onFilter,
}: {
  hits: BookmarkHit[];
  page?: ToolPageMeta;
  fetchPage?: (offset: number, limit: number) => Promise<{ rows: BookmarkHit[]; page: ToolPageMeta }>;
  showScore: boolean;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  const noop = useCallback(
    async () => ({ rows: [] as BookmarkHit[], page: initialPage as ToolPageMeta }),
    [initialPage],
  );
  const { rows, page, loading, error, loadMore } = useToolPaging(hits, fetchPage ? initialPage : undefined, fetchPage ?? noop);
  const { query, setQuery, filtered, active } = useTextFilter(
    rows,
    (h) => `${h.title} ${h.url} ${h.category} ${(h.tags ?? []).join(" ")}`,
  );
  const { expanded, toggle, visibleCount, hidden, nextChunk } = useExpandable(filtered.length);

  if (!rows.length) return <CardNote>No matches in the library.</CardNote>;

  return (
    <div>
      {rows.length > 6 && (
        <CardToolbar
          query={query}
          onQuery={setQuery}
          placeholder="Filter results by title, site or tag…"
          summary={active ? `${filtered.length} of ${rows.length}` : `${rows.length} result${rows.length === 1 ? "" : "s"}`}
        />
      )}
      {filtered.length === 0 ? (
        <CardNote>No result matches “{query}”.</CardNote>
      ) : (
        <ul className="divide-y">
          {filtered.slice(0, visibleCount).map((r) => (
            <BookmarkRow key={r.id} hit={r} showScore={showScore} onFilter={onFilter} />
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <div className="border-t px-2 py-1">
          <ShowMoreRow hidden={hidden} expanded={expanded} onToggle={toggle} noun="result" nextChunk={nextChunk} />
        </div>
      )}
      <PageFooter
        page={page}
        firstOffset={initialPage?.offset ?? 0}
        shown={rows.length}
        noun="results"
        loading={loading}
        error={error}
        onLoadMore={loadMore}
      />
    </div>
  );
}

function BookmarkRow({
  hit: r,
  showScore,
  onFilter,
}: {
  hit: BookmarkHit;
  showScore: boolean;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  const href = safeHref(r.url);
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50">
      <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/* line-clamp-1 (not truncate): nowrap text would set the row's
              intrinsic min-content width and stretch the page sideways. */}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="line-clamp-1 min-w-0 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
            >
              {r.title}
            </a>
          ) : (
            <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{r.title}</span>
          )}
          {showScore && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {Math.round(r.score * 100)}% match
            </span>
          )}
        </div>
        <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {hostOf(r.url)}
          {r.day ? ` · ${r.day}` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onFilter?.({ category: r.category })}
            title={`Category: ${r.category} — click to filter`}
            className="cursor-pointer inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-85"
          >
            <Folder className="size-2.5" aria-hidden />
            {r.category}
          </button>
          {(r.tags ?? []).slice(0, 4).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onFilter?.({ tag: t })}
              title={`Show #${t} bookmarks`}
              className="cursor-pointer rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              #{t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <CopyLinkButton url={r.url} />
        {href && (
          <Button variant="ghost" size="icon" className="size-7 cursor-pointer" asChild>
            <a href={href} target="_blank" rel="noreferrer noopener" aria-label={`Open ${r.title}`} title="Open in new tab">
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}
