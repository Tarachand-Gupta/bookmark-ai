import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BookmarkHit, SearchMode, SearchToolOutput, ToolPageMeta } from "@bookmark-ai/types";
import { searchBookmarksPage } from "../../../api";
import { useAppTheme } from "../../../context/PreferencesContext";
import { useFold, useTextFilter, useToolPaging } from "../../../hooks/useChatCard";
import {
  bookmarkSubtitle,
  countSummary,
  openableUrl,
  pageSearchResponse,
  scoreLabel,
  showFilter,
  showScores,
  visibleTags,
} from "../../../lib/chatCards";
import { Symbol } from "../../Symbol";
import { CardNote, Chip, FilterField, PageFooter, ShowMoreButton, openCardLink } from "./ChatCardParts";

/**
 * `searchBookmarks` as a card: ONE PAGE of hits (title, host · day, category +
 * tag chips; tap opens), a substring filter over what's loaded, folding past
 * 10, and "Load next 50" that re-runs the same search against /api/search —
 * no model turn. "% match" shows only for semantic searches.
 */
export function ChatBookmarksCard({ output }: { output: SearchToolOutput }) {
  const q = output.query ?? "";
  const mode = (output.mode === "ai" ? "ai" : output.mode) as SearchMode;
  const fetchPage = useCallback(
    async (offset: number, limit: number): Promise<{ rows: BookmarkHit[]; page: ToolPageMeta }> => {
      const res = await searchBookmarksPage(q, mode, { limit, offset });
      return pageSearchResponse(res.results, res.hasMore, offset, limit);
    },
    [q, mode],
  );
  // Without an echoed query there is nothing to re-run (a turn stored before
  // paging shipped) — the card stays a plain list.
  const { rows, page, loading, error, loadMore } = useToolPaging(
    output.results ?? [],
    q ? output.page : undefined,
    fetchPage,
  );
  const { query, setQuery, filtered, active } = useTextFilter(
    rows,
    (h) => `${h.title} ${h.url} ${h.category} ${(h.tags ?? []).join(" ")}`,
  );
  const { visibleCount, hidden, expanded, nextChunk, toggle } = useFold(filtered.length);
  const { colors } = useAppTheme();

  if (rows.length === 0) return <CardNote>No matches in the library.</CardNote>;

  return (
    <View>
      {showFilter(rows.length) && (
        <FilterField
          query={query}
          onQuery={setQuery}
          placeholder="Filter results by title, site or tag…"
          summary={countSummary(active, filtered.length, rows.length, "result")}
        />
      )}
      {filtered.length === 0 ? (
        <CardNote>{`No result matches “${query}”.`}</CardNote>
      ) : (
        filtered
          .slice(0, visibleCount)
          .map((hit, i) => <BookmarkRow key={hit.id} hit={hit} score={showScores(output.mode)} first={i === 0} />)
      )}
      {(hidden > 0 || expanded) && (
        <View style={[styles.showMoreWrap, { borderTopColor: colors.border }]}>
          <ShowMoreButton hidden={hidden} expanded={expanded} nextChunk={nextChunk} noun="result" onToggle={toggle} />
        </View>
      )}
      <PageFooter
        page={page}
        firstOffset={output.page?.offset ?? 0}
        shown={rows.length}
        noun="results"
        loading={loading}
        error={error}
        onLoadMore={() => void loadMore()}
      />
    </View>
  );
}

function BookmarkRow({ hit, score, first }: { hit: BookmarkHit; score: boolean; first: boolean }) {
  const { colors } = useAppTheme();
  const href = openableUrl(hit.url);
  const tags = visibleTags(hit.tags);
  return (
    <Pressable
      onPress={href ? () => openCardLink(href) : undefined}
      disabled={!href}
      accessibilityRole={href ? "link" : "text"}
      accessibilityLabel={hit.title}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.muted },
      ]}
    >
      <View style={styles.icon}>
        <Symbol name="globe" size={15} color={colors.mutedForeground} fallback="◍" />
      </View>
      <View style={styles.texts}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
            {hit.title || hit.url}
          </Text>
          {score && (
            <Text style={[styles.score, { color: colors.mutedForeground }]}>{scoreLabel(hit.score)}</Text>
          )}
        </View>
        <Text numberOfLines={1} style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {bookmarkSubtitle(hit.url, hit.day)}
        </Text>
        <View style={styles.chips}>
          {hit.category ? <Chip label={hit.category} filled /> : null}
          {tags.map((t) => (
            <Chip key={t} label={`#${t}`} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  icon: { width: 18, alignItems: "center", marginTop: 2 },
  texts: { flex: 1, gap: 2 },
  titleLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  title: { fontSize: 15, fontWeight: "500", flexShrink: 1 },
  score: { fontSize: 11, fontVariant: ["tabular-nums"] },
  subtitle: { fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },
  showMoreWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
});
