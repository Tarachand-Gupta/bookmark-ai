import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { Session, SessionTab } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";
import { FaviconTile } from "./BookmarkRow";
import { Symbol } from "./Symbol";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Row =
  | { kind: "tab"; tab: SessionTab; index: number; matched: boolean }
  | { kind: "fold"; start: number; tabs: SessionTab[] };

/**
 * One saved-session card: tap to expand its tabs, tap a tab to open it.
 * With `matchQuery` set (search results), non-matching tabs fold away into
 * git-diff-style "N more tabs" rows that reveal per run.
 */
export function SessionCard({
  session,
  matchQuery,
  initialExpanded = false,
  onLongPressDelete,
}: {
  session: Session;
  matchQuery?: string;
  initialExpanded?: boolean;
  onLongPressDelete?: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const [expanded, setExpanded] = useState(initialExpanded);

  const q = matchQuery?.trim().toLowerCase() ?? "";
  const matches = (t: SessionTab) =>
    q.length > 0 && (t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
  const matchCount = q ? session.tabs.filter(matches).length : 0;

  // Runs of non-matching tabs collapse between the matches (like unchanged
  // lines in a diff). No tab matches (session matched by name) → no folding.
  const rows = useMemo<Row[]>(() => {
    if (matchCount === 0) {
      return session.tabs.map((tab, index) => ({ kind: "tab", tab, index, matched: false }));
    }
    const out: Row[] = [];
    let run: SessionTab[] = [];
    session.tabs.forEach((tab, index) => {
      if (matches(tab)) {
        if (run.length > 0) {
          out.push({ kind: "fold", start: index - run.length, tabs: run });
          run = [];
        }
        out.push({ kind: "tab", tab, index, matched: true });
      } else {
        run.push(tab);
      }
    });
    if (run.length > 0) {
      out.push({ kind: "fold", start: session.tabs.length - run.length, tabs: run });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tabs, matchCount, q]);

  // Per-run reveal, keyed by the run's starting tab index; new query refolds.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  useEffect(() => setRevealed(new Set()), [q]);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          setExpanded((v) => !v);
        }}
        onLongPress={onLongPressDelete}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.cardHeader, pressed && { backgroundColor: colors.muted }]}
      >
        <View style={[styles.stackBadge, { backgroundColor: colors.muted }]}>
          <Symbol name="square.stack" size={18} color={colors.foreground} fallback="▣" />
        </View>
        <View style={styles.cardTitles}>
          <Text numberOfLines={1} style={[styles.cardTitle, { color: colors.foreground }]}>
            {session.name || "Untitled session"}
          </Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
            {session.tabCount} tab{session.tabCount === 1 ? "" : "s"} · {session.browser} ·{" "}
            {dateLabel(session.savedAt)}
            {matchCount > 0 ? ` · ${matchCount} match${matchCount === 1 ? "" : "es"}` : ""}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
          <Symbol name="chevron.right" size={14} color={colors.mutedForeground} fallback="›" />
        </View>
      </Pressable>

      {/* The AI's read of this window of tabs (generated on save by the server —
          read-only here; regeneration lives in the web app). Quiet sparkle-led
          strip, same vocabulary as the web session card's summary block. */}
      {session.description ? (
        <View style={[styles.summaryRow, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
          <Symbol name="sparkles" size={13} color={colors.mutedForeground} fallback="✦" />
          <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
            {session.description}
          </Text>
        </View>
      ) : null}

      {expanded &&
        rows.map((row) => {
          if (row.kind === "tab") {
            return (
              <TabRow
                key={`${session.id}-${row.index}`}
                tab={row.tab}
                matched={row.matched}
              />
            );
          }
          if (revealed.has(row.start)) {
            return row.tabs.map((t, j) => (
              <TabRow key={`${session.id}-${row.start + j}`} tab={t} matched={false} />
            ));
          }
          return (
            <Pressable
              key={`${session.id}-fold-${row.start}`}
              onPress={() => {
                void Haptics.selectionAsync();
                setRevealed((prev) => new Set(prev).add(row.start));
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.foldRow,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.muted },
              ]}
            >
              <Text style={[styles.foldText, { color: colors.mutedForeground }]}>
                ⋯ {row.tabs.length} more tab{row.tabs.length === 1 ? "" : "s"} ⋯
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}

function TabRow({ tab, matched }: { tab: SessionTab; matched: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={() => void Linking.openURL(tab.url)}
      accessibilityRole="link"
      style={({ pressed }) => [
        styles.tabRow,
        { borderTopColor: colors.border },
        matched && { backgroundColor: colors.muted },
        pressed && { backgroundColor: colors.border },
      ]}
    >
      {/* Sessions saved by the extension carry each tab's favIconUrl; rows
          seeded by other clients may not — FaviconTile falls back to the
          neutral glyph, so the leading slot is stable either way. */}
      <FaviconTile url={tab.favIconUrl} size={24} />
      <View style={styles.tabTexts}>
        <Text
          numberOfLines={1}
          style={[
            styles.tabTitle,
            { color: colors.foreground, fontWeight: matched ? "600" : "400" },
          ]}
        >
          {tab.title || hostOf(tab.url)}
        </Text>
        <Text numberOfLines={1} style={[styles.tabHost, { color: colors.mutedForeground }]}>
          {hostOf(tab.url)}
        </Text>
      </View>
      <Symbol name="arrow.up.right" size={13} color={colors.mutedForeground} fallback="↗" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  stackBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitles: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  cardMeta: { fontSize: 13 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  summaryText: { flex: 1, fontSize: 13, lineHeight: 18 },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    // 28 + padding 14 + favicon 24 + gap 10 = 76: tab TITLES keep the exact
    // x-position they had before the favicon (62 + 14), icon under the badge.
    marginLeft: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabTexts: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 15 },
  tabHost: { fontSize: 13 },
  foldRow: {
    alignItems: "center",
    paddingVertical: 8,
    marginLeft: 62,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  foldText: { fontSize: 13, fontWeight: "500", letterSpacing: 0.5 },
});
