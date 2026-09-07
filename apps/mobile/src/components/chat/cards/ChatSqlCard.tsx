import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { SqlToolOutput, ToolPageMeta } from "@bookmark-ai/types";
import { runChatQueryPage } from "../../../api";
import { useAppTheme } from "../../../context/PreferencesContext";
import { useFold, useTextFilter, useToolPaging } from "../../../hooks/useChatCard";
import {
  SQL_CLIPPED_NOTE,
  carrySqlTotal,
  cellText,
  countSummary,
  showFilter,
  sqlCardState,
  sqlColumnWidths,
} from "../../../lib/chatCards";
import { CardNote, FilterField, MONO_FAMILY, PageFooter, ShowMoreButton } from "./ChatCardParts";

/**
 * `queryDatabase` as a card: the SQL that ran (visible even mid-stream and
 * after a failure) above a real table with a row filter, chunked "show more",
 * and a "Load next 50" that re-runs the SAME SELECT through /api/query — the
 * engine path and guards the tool used, with no model turn. The SQL block and
 * the table each scroll sideways inside their OWN ScrollView — a wide SELECT
 * must never widen the thread.
 */
export function ChatSqlCard({ input, output }: { input: unknown; output: SqlToolOutput | undefined }) {
  const { colors } = useAppTheme();
  const { sql, table } = sqlCardState(input, output);
  if (!sql && !table) return null;
  return (
    <View>
      {sql.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: colors.muted }}
          contentContainerStyle={styles.sqlContent}
        >
          <Text selectable style={[styles.sql, { color: colors.foreground }]}>
            {sql}
          </Text>
        </ScrollView>
      )}
      {table && output && (
        <View style={sql.length > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }}>
          <SqlResultTable
            columns={table.columns}
            rows={table.rows}
            truncated={output.truncated === true}
            page={output.page}
            sql={output.sql ?? sql}
          />
        </View>
      )}
    </View>
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
  truncated: boolean;
  page?: ToolPageMeta;
  sql: string;
}) {
  const { colors } = useAppTheme();
  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const res = await runChatQueryPage(sql, { limit, offset });
      return { rows: res.rows, page: carrySqlTotal(res.page, initialPage) };
    },
    [sql, initialPage],
  );
  const { rows, page, loading, error, loadMore } = useToolPaging(
    initialRows,
    sql ? initialPage : undefined,
    fetchPage,
  );
  const { query, setQuery, filtered, active } = useTextFilter(rows, (r) => r.map(cellText).join(" "));
  const { visibleCount, hidden, expanded, nextChunk, toggle } = useFold(filtered.length);

  const widths = useMemo(() => sqlColumnWidths(columns, filtered.slice(0, visibleCount)), [columns, filtered, visibleCount]);

  if (rows.length === 0) return <CardNote>No rows.</CardNote>;

  return (
    <View>
      {showFilter(rows.length) && (
        <FilterField
          query={query}
          onQuery={setQuery}
          placeholder="Filter rows…"
          summary={countSummary(active, filtered.length, rows.length, "row")}
        />
      )}
      {filtered.length === 0 ? (
        <CardNote>{`No row matches “${query}”.`}</CardNote>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table}>
            <View style={[styles.row, { backgroundColor: colors.muted }]}>
              {columns.map((c, ci) => (
                <Cell key={`${c}-${ci}`} text={c} width={widths[ci] ?? 72} header first={ci === 0} />
              ))}
            </View>
            {filtered.slice(0, visibleCount).map((row, ri) => (
              <View
                key={ri}
                style={[styles.row, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                {columns.map((_, ci) => (
                  <Cell key={ci} text={cellText(row[ci])} width={widths[ci] ?? 72} first={ci === 0} />
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {(hidden > 0 || expanded || truncated) && (
        <View style={[styles.below, { borderTopColor: colors.border }]}>
          <ShowMoreButton hidden={hidden} expanded={expanded} nextChunk={nextChunk} noun="row" onToggle={toggle} />
          {truncated && (
            <Text style={[styles.clipped, { color: colors.mutedForeground }]}>{SQL_CLIPPED_NOTE}</Text>
          )}
        </View>
      )}
      <PageFooter
        page={page}
        firstOffset={initialPage?.offset ?? 0}
        shown={rows.length}
        noun="rows"
        loading={loading}
        error={error}
        onLoadMore={() => void loadMore()}
      />
    </View>
  );
}

function Cell({ text, width, header, first }: { text: string; width: number; header?: boolean; first: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Text
      numberOfLines={3}
      selectable={!header}
      style={[
        styles.cell,
        header && styles.headerCell,
        {
          width,
          color: header ? colors.foreground : colors.cardForeground,
          borderLeftColor: colors.border,
          borderLeftWidth: first ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  sqlContent: { paddingHorizontal: 12, paddingVertical: 8 },
  sql: { fontFamily: MONO_FAMILY, fontSize: 12, lineHeight: 17 },
  table: { minWidth: "100%" },
  row: { flexDirection: "row" },
  cell: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  headerCell: { fontWeight: "600" },
  below: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clipped: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 8 },
});
