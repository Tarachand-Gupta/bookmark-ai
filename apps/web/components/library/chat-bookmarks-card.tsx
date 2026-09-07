"use client";

import { ExternalLink, Folder, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryFilters } from "@/lib/api";
import { hostOf } from "@/lib/chat-tools";
import { safeHref } from "@/lib/safe-href";
import {
  CardNote,
  CardToolbar,
  CopyLinkButton,
  ShowMoreRow,
  useExpandable,
  useTextFilter,
} from "./chat-card-parts";
import type { BookmarkHit, SearchToolOutput } from "./chat-tool-types";

/**
 * `searchBookmarks` as a card: the hits with their category/tag chips (click to
 * filter the library), a substring filter and the same fold-past-8 truncation as
 * the other chat cards. The model only sees a counted digest of this, so the
 * card IS the list — it must stay browsable rather than pretty.
 */
export function BookmarksCard({
  output,
  onFilter,
}: {
  output: SearchToolOutput;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  return (
    <BookmarkHits hits={output.results ?? []} showScore={output.mode === "ai"} onFilter={onFilter} />
  );
}

export function BookmarkHits({
  hits,
  showScore,
  onFilter,
}: {
  hits: BookmarkHit[];
  showScore: boolean;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  const { query, setQuery, filtered, active } = useTextFilter(
    hits,
    (h) => `${h.title} ${h.url} ${h.category} ${(h.tags ?? []).join(" ")}`,
  );
  const { expanded, toggle, visibleCount, hidden } = useExpandable(filtered.length);

  if (!hits.length) return <CardNote>No matches in the library.</CardNote>;

  return (
    <div>
      {hits.length > 6 && (
        <CardToolbar
          query={query}
          onQuery={setQuery}
          placeholder="Filter results by title, site or tag…"
          summary={active ? `${filtered.length} of ${hits.length}` : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
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
          <ShowMoreRow hidden={hidden} expanded={expanded} onToggle={toggle} noun="result" />
        </div>
      )}
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
