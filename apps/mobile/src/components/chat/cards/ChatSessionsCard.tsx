import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SessionHit, SessionsToolOutput, ToolPageMeta } from "@bookmark-ai/types";
import { listSessions } from "../../../api";
import { useAppTheme } from "../../../context/PreferencesContext";
import { useFold, useTextFilter, useToolPaging } from "../../../hooks/useChatCard";
import {
  SESSIONS_FILTER_MIN_ROWS,
  beyondPayload,
  beyondPayloadNote,
  hostOf,
  openableUrl,
  pageSessionsSnapshot,
  sessionMeta,
  sessionsSummary,
  showFilter,
} from "../../../lib/chatCards";
import { Symbol } from "../../Symbol";
import { CardNote, FilterField, PageFooter, ShowMoreButton, TabFavicon, openCardLink } from "./ChatCardParts";

/**
 * `listSessions` as a card: one section per saved snapshot (name, browser ·
 * tab count, the AI description) with its tabs underneath, folded past 10.
 * The filter matches names, descriptions and tab titles/URLs — the same
 * targets the tool's own filter uses. "Load next 50" re-reads /api/sessions
 * (the whole, small list) and slices the next page client-side.
 */
export function ChatSessionsCard({ output }: { output: SessionsToolOutput }) {
  const toolQuery = output.query ?? undefined;
  const fetchPage = useCallback(
    async (offset: number, limit: number): Promise<{ rows: SessionHit[]; page: ToolPageMeta }> =>
      pageSessionsSnapshot((await listSessions()).sessions, toolQuery, offset, limit),
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
    <View>
      {showFilter(sessions.length, SESSIONS_FILTER_MIN_ROWS) && (
        <FilterField
          query={query}
          onQuery={setQuery}
          placeholder="Filter sessions by name, summary or tab…"
          summary={sessionsSummary(active, filtered.length, sessions.length, page?.total)}
        />
      )}
      {filtered.length === 0 ? (
        <CardNote>{`No session matches “${query}”.`}</CardNote>
      ) : (
        filtered.map((s, i) => <SessionSection key={s.id} session={s} first={i === 0} />)
      )}
      <PageFooter
        page={page}
        firstOffset={output.page?.offset ?? 0}
        shown={sessions.length}
        noun="sessions"
        loading={loading}
        error={error}
        onLoadMore={() => void loadMore()}
      />
    </View>
  );
}

function SessionSection({ session: s, first }: { session: SessionHit; first: boolean }) {
  const { colors } = useAppTheme();
  const tabs = s.tabs ?? [];
  const { visibleCount, hidden, expanded, nextChunk, toggle } = useFold(tabs.length);
  const beyond = beyondPayloadNote(beyondPayload(s.tabCount, tabs.length));
  return (
    <View
      style={[styles.section, !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
    >
      <View style={styles.header}>
        <Symbol name="square.stack" size={14} color={colors.mutedForeground} fallback="▤" />
        <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
          {s.name}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{sessionMeta(s.browser, s.tabCount)}</Text>
      </View>
      {s.description ? (
        <Text numberOfLines={2} style={[styles.description, { color: colors.mutedForeground }]}>
          {s.description}
        </Text>
      ) : null}
      <View style={styles.tabs}>
        {tabs.slice(0, visibleCount).map((t, i) => (
          <SessionTabRow key={`${t.url}-${i}`} title={t.title} url={t.url} />
        ))}
      </View>
      {(hidden > 0 || expanded || beyond !== null) && (
        <View style={styles.below}>
          <ShowMoreButton hidden={hidden} expanded={expanded} nextChunk={nextChunk} noun="tab" onToggle={toggle} />
          {beyond !== null && <Text style={[styles.beyond, { color: colors.mutedForeground }]}>{beyond}</Text>}
        </View>
      )}
    </View>
  );
}

function SessionTabRow({ title, url }: { title: string; url: string }) {
  const { colors, radius } = useAppTheme();
  const href = openableUrl(url);
  const label = title || url;
  return (
    <Pressable
      onPress={href ? () => openCardLink(href) : undefined}
      disabled={!href}
      accessibilityRole={href ? "link" : "text"}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tabRow,
        { borderRadius: radius.sm },
        pressed && { backgroundColor: colors.muted },
      ]}
    >
      <TabFavicon url={url} size={16} />
      <View style={styles.tabTexts}>
        <Text numberOfLines={1} style={[styles.tabTitle, { color: colors.foreground }]}>
          {label}
        </Text>
        <Text numberOfLines={1} style={[styles.tabHost, { color: colors.mutedForeground }]}>
          {hostOf(url)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontWeight: "600", flex: 1 },
  meta: { fontSize: 12, fontVariant: ["tabular-nums"] },
  description: { fontSize: 13, lineHeight: 18, marginTop: 3, paddingLeft: 22 },
  tabs: { marginTop: 6, paddingLeft: 14 },
  tabRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 40,
  },
  tabTexts: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 14 },
  tabHost: { fontSize: 12 },
  below: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingLeft: 14 },
  beyond: { fontSize: 12, paddingHorizontal: 6 },
});
