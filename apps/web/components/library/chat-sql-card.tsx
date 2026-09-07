"use client";

import { useCallback } from "react";
import {
  CardNote,
  CardToolbar,
  PageFooter,
  ShowMoreRow,
  useExpandable,
  useTextFilter,
  useToolPaging,
} from "./chat-card-parts";
import type { SqlToolOutput, ToolPageMeta } from "./chat-tool-types";
import { cellText } from "@bookmark-ai/types";
import { runChatQueryPage } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * `queryDatabase` as a card: the SQL that ran (visible even mid-stream) above a
 * real table with a row filter, chunked "show more", and a "Load next 50" that
 * re-runs the SAME SELECT through /api/query — the same engine path and guards
 * the tool used, with no model turn. The table scrolls inside its OWN container
 * — a wide SELECT must never widen the chat column.
 */
export function SqlCard({
  input,
  output,
}: {
  input: { sql?: string } | undefined;
  output: SqlToolOutput | undefined;
}) {
  const sql = typeof input?.sql === "string" ? input.sql : "";
  if (!sql && !output?.columns) return null;
  return (
    <>
      {sql && (
        <pre className="overflow-x-auto bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
          <code>{sql}</code>
        </pre>
      )}
      {output?.columns && output.rows && (
        <div className={cn(sql && "border-t")}>
          <SqlResultTable
            columns={output.columns}
            rows={output.rows}
            truncated={output.truncated}
            page={output.page}
            sql={output.sql ?? sql}
          />
        </div>
      )}
    </>
  );
}

function SqlResultTable({
  columns,
  rows: initialRows,
  truncated,
  page: initialPage,
  sql,
}: {
  columns: string[];
  rows: unknown[][];
  truncated?: boolean;
  page?: ToolPageMeta;
  sql: string;
}) {
  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const res = await runChatQueryPage(sql, { limit, offset });
      // Keep the total the FIRST page established — /api/query doesn't recount.
      return { rows: res.rows, page: { ...res.page, total: initialPage?.total ?? null } };
    },
    [sql, initialPage?.total],
  );
  const { rows, page, loading, error, loadMore } = useToolPaging(
    initialRows,
    sql ? initialPage : undefined,
    fetchPage,
  );
  const { query, setQuery, filtered, active } = useTextFilter(rows, (r) => r.map(cellText).join(" "));
  const { expanded, toggle, visibleCount, hidden, nextChunk } = useExpandable(filtered.length);

  if (!rows.length) return <CardNote>No rows.</CardNote>;

  return (
    <div>
      {rows.length > 6 && (
        <CardToolbar
          query={query}
          onQuery={setQuery}
          placeholder="Filter rows…"
          summary={active ? `${filtered.length} of ${rows.length}` : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
        />
      )}
      {filtered.length === 0 ? (
        <CardNote>No row matches “{query}”.</CardNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                {columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap px-2 py-1 text-left font-medium [overflow-wrap:normal]"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visibleCount).map((row, ri) => (
                <tr key={ri} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                  {columns.map((_, ci) => (
                    <td
                      key={ci}
                      className="max-w-[20rem] px-2 py-1 align-top [overflow-wrap:normal] [word-break:normal]"
                    >
                      {cellText(row[ci])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(hidden > 0 || truncated) && (
        <div className="flex items-center gap-2 border-t px-2 py-1">
          <ShowMoreRow hidden={hidden} expanded={expanded} onToggle={toggle} noun="row" nextChunk={nextChunk} />
          {truncated && (
            <span className="text-[10px] text-muted-foreground">Long cell values were clipped.</span>
          )}
        </div>
      )}
      <PageFooter
        page={page}
        firstOffset={initialPage?.offset ?? 0}
        shown={rows.length}
        noun="rows"
        loading={loading}
        error={error}
        onLoadMore={loadMore}
      />
    </div>
  );
}
