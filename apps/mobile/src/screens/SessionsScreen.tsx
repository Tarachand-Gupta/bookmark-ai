import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Session } from "@bookmark-ai/types";
import { SessionCard } from "../components/SessionCard";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useSessions } from "../hooks/useSessions";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

/** Sessions tab: saved browser-tab snapshots. Tap a session to expand its
 * tabs, tap a tab to open it in the browser, long-press to delete. */
export function SessionsScreen() {
  const { colors } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();
  const { sessions, loading, refreshing, error, refresh, remove } = useSessions();

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
          <SessionCard session={item} onLongPressDelete={() => confirmDelete(item)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: 6, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 20 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  count: { fontSize: 13 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
});
