"use client";

import { useCallback } from "react";
import { Layers } from "lucide-react";
import { getSessions } from "@/lib/api";
import { hostOf } from "@/lib/chat-tools";
import { safeHref } from "@/lib/safe-href";
import {
  CardNote,
  CardToolbar,
  PageFooter,
  ShowMoreRow,
  TabFavicon,
  useExpandable,
  useTextFilter,
  useToolPaging,
} from "./chat-card-parts";
import type { SessionHit, SessionsToolOutput, ToolPageMeta } from "./chat-tool-types";

/**
 * `listSessions` as a card: one section per saved snapshot (name, tab count,
 * browser, the AI description) with its tabs listed underneath and folded past
 * 8. The filter matches names, descriptions and tab titles/URLs — the same
 * targets the server-side filter uses — so narrowing here mirrors re-asking.
 */
export function SessionsCard({ output }: { output: SessionsToolOutput }) {
  const toolQuery = output.query ?? undefined;
  // /api/sessions returns the whole (small) list in one call, so a later page is
  // sliced from it here — the same filter the tool applied, then the same offset.
  const fetchPage = useCallback(
    async (offset: number, limit: number): Promise<{ rows: SessionHit[]; page: ToolPageMeta }> => {
      const { sessions: all } = await getSessions();
      const q = toolQuery?.trim().toLowerCase();
      const matching = q
        ? all.filter((sn) =>
            [sn.name, sn.description ?? "", ...sn.tabs.flatMap((t) => [t.title ?? "", t.url])].some((f) =>
              f.toLowerCase().includes(q),
            ),
          )
        : all;
      const slice = matching.slice(offset, offset + limit);
      const hasMore = matching.length > offset + limit;
      return {
        rows: slice.map((sn) => ({
          id: sn.id,
          name: sn.name,
          description: sn.description ?? null,
          tabCount: sn.tabCount,
          browser: sn.browser,
          savedAt: sn.savedAt,
          tabs: sn.tabs.slice(0, 15).map((t) => ({ title: t.title ?? "", url: t.url })),
        })),
        page: {
          total: matching.length,
          offset,
          limit,
          hasMore,
          nextOffset: hasMore ? offset + limit : null,
        },
      };
    },
    [toolQuery],
  );
  const { rows: sessions, page, loading, error, loadMore } = useToolPaging(
    output.sessions ?? [],
    output.page,
    fetchPage,
  );
  const { query, setQuery, filtered, active } = useTextFilter(
    sessions,
    (s) => `${s.name} ${s.description ?? ""} ${(s.tabs ?? []).map((t) => `${t.title} ${t.url}`).join(" ")}`,
  );

  if (sessions.length === 0) return <CardNote>No saved sessions found.</CardNote>;

  return (
    <div>
      {sessions.length > 4 && (
        <CardToolbar
          query={query}
          onQuery={setQuery}
          placeholder="Filter sessions by name, summary or tab…"
          summary={
            active
              ? `${filtered.length} of ${sessions.length}`
              : `${page?.total ?? sessions.length} session${(page?.total ?? sessions.length) === 1 ? "" : "s"}`
          }
        />
      )}
      {filtered.length === 0 ? (
        <CardNote>No session matches “{query}”.</CardNote>
      ) : (
        <ul className="divide-y">
          {filtered.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </ul>
      )}
      <PageFooter
        page={page}
        firstOffset={output.page?.offset ?? 0}
        shown={sessions.length}
        noun="sessions"
        loading={loading}
        error={error}
        onLoadMore={loadMore}
      />
    </div>
  );
}

function SessionRow({ session: s }: { session: SessionHit }) {
  const tabs = s.tabs ?? [];
  const { expanded, toggle, visibleCount, hidden, nextChunk } = useExpandable(tabs.length);
  // The tool ships at most 15 tabs per session; anything beyond that lives only
  // in the session itself, so the count is spelled out rather than promised.
  const beyondPayload = Math.max(0, (s.tabCount ?? 0) - tabs.length);

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <Layers className="mt-0.5 size-3.5 shrink-0 self-start text-muted-foreground" aria-hidden />
        <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{s.name}</span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums capitalize text-muted-foreground">
          {s.browser} · {s.tabCount} tab{s.tabCount === 1 ? "" : "s"}
        </span>
      </div>
      {s.description && (
        <p className="mt-0.5 line-clamp-2 pl-5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {s.description}
        </p>
      )}
      <ul className="mt-1.5 space-y-0.5 pl-5">
        {tabs.slice(0, visibleCount).map((t, i) => {
          const href = safeHref(t.url);
          return (
            <li key={`${t.url}-${i}`} className="flex items-start gap-2 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted/50">
              <TabFavicon url={t.url} />
              <div className="min-w-0 flex-1">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={t.url}
                    className="line-clamp-1 text-xs hover:underline [overflow-wrap:anywhere]"
                  >
                    {t.title || t.url}
                  </a>
                ) : (
                  <span className="line-clamp-1 text-xs [overflow-wrap:anywhere]">{t.title || t.url}</span>
                )}
                <p className="line-clamp-1 text-[10px] text-muted-foreground [overflow-wrap:anywhere]">
                  {hostOf(t.url)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || beyondPayload > 0) && (
        <div className="mt-1 flex items-center gap-2 pl-5">
          <ShowMoreRow hidden={hidden} expanded={expanded} onToggle={toggle} noun="tab" nextChunk={nextChunk} />
          {beyondPayload > 0 && (
            <span className="text-[10px] text-muted-foreground">+{beyondPayload} more in the session</span>
          )}
        </div>
      )}
    </li>
  );
}
