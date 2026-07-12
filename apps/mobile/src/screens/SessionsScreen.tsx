import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Session, SessionTab } from "@bookmark-ai/types";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useSessions } from "../hooks/useSessions";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Sessions tab: saved browser-tab snapshots. Tap a session to expand its
 * tabs, tap a tab to open it in the browser, long-press to delete. */
export function SessionsScreen() {
  const { colors } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();
  const { sessions, loading, refreshing, error, refresh, remove } = useSessions();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const confirmDelete = (session: Session) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Delete session?",
      `"${session.name || "Untitled session"}" (${session.tabCount} tabs) will be removed everywhere.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            remove(session.id).catch((err: unknown) => {
              Alert.alert(
                "Could not delete",
                err instanceof Error ? err.message : String(err),
              );
            });
          },
        },
      ],
    );
  };

  const empty = loading ? (
    <ActivityIndicator style={styles.empty} color={colors.mutedForeground} />
  ) : (
    <View style={styles.empty}>
      <Symbol name="square.stack" size={28} color={colors.mutedForeground} fallback="▣" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {error ? "Could not load" : "No sessions yet"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {error ??
          "A session is a snapshot of all your open tabs — save one from the browser extension."}
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.largeTitle, { color: colors.foreground }]}>Sessions</Text>
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {loading
                ? "Loading…"
                : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
            </Text>
          </View>
        }
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            expanded={expandedId === item.id}
            onToggle={() =>
              setExpandedId((prev) => (prev === item.id ? null : item.id))
            }
            onDelete={() => confirmDelete(item)}
          />
        )}
      />
    </View>
  );
}

function SessionCard({
  session,
  expanded,
  onToggle,
  onDelete,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { colors, radius } = useAppTheme();
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
          onToggle();
        }}
        onLongPress={onDelete}
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
          </Text>
        </View>
        <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
          <Symbol name="chevron.right" size={14} color={colors.mutedForeground} fallback="›" />
        </View>
      </Pressable>

      {expanded &&
        session.tabs.map((tab, i) => (
          <TabRow key={`${session.id}-${i}`} tab={tab} last={i === session.tabs.length - 1} />
        ))}
    </View>
  );
}

function TabRow({ tab, last }: { tab: SessionTab; last: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={() => void Linking.openURL(tab.url)}
      accessibilityRole="link"
      style={({ pressed }) => [
        styles.tabRow,
        { borderTopColor: colors.border },
        last && styles.tabRowLast,
        pressed && { backgroundColor: colors.muted },
      ]}
    >
      <View style={styles.tabTexts}>
        <Text numberOfLines={1} style={[styles.tabTitle, { color: colors.foreground }]}>
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
  root: { flex: 1 },
  header: { gap: 6, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 20 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  count: { fontSize: 13 },
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
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginLeft: 62,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabRowLast: { paddingBottom: 12 },
  tabTexts: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 15 },
  tabHost: { fontSize: 13 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
});
