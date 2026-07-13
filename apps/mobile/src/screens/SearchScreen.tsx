import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BookmarkRow } from "../components/BookmarkRow";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useSearch } from "../hooks/useSearch";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

/** Search tab: one iOS search field — results blend keyword and semantic
 * matches server-side (hybrid RRF), most relevant first, as you type. */
export function SearchScreen() {
  const { colors, radius } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();
  const search = useSearch();
  const hasQuery = search.query.trim().length > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.largeTitle, { color: colors.foreground }]}>Search</Text>
        <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.lg }]}>
          <Symbol name="magnifyingglass" size={17} color={colors.mutedForeground} fallback="⌕" />
          <TextInput
            value={search.query}
            onChangeText={search.setQuery}
            placeholder="Titles, tags, questions…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: colors.foreground }]}
          />
          {hasQuery && (
            <Pressable onPress={() => search.setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Symbol name="xmark.circle.fill" size={18} color={colors.mutedForeground} fallback="✕" />
            </Pressable>
          )}
        </View>
        {(search.searching || (hasQuery && search.keywordOnly)) && (
          <View style={styles.statusRow}>
            {search.searching ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                Keyword matches only — AI ranking is unavailable right now.
              </Text>
            )}
          </View>
        )}
      </View>

      <FlatList
        data={search.results}
        keyExtractor={(b) => b.id}
        renderItem={({ item, index }) => (
          <BookmarkRow bookmark={item} last={index === search.results.length - 1} />
        )}
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        ListEmptyComponent={
          <View style={styles.empty}>
            {hasQuery && !search.searching ? (
              <>
                <Symbol name="questionmark.circle" size={28} color={colors.mutedForeground} fallback="?" />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {search.error ? "Search failed" : "No matches"}
                </Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  {search.error ?? "Try different words or phrasing."}
                </Text>
              </>
            ) : !hasQuery ? (
              <>
                <Symbol name="sparkles" size={28} color={colors.mutedForeground} fallback="✦" />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Search your library
                </Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  Exact words and meaning both count — try “that tool for tracing LLM calls”.
                </Text>
              </>
            ) : null}
          </View>
        }
        ListHeaderComponent={
          hasQuery && !search.searching && search.results.length > 0 ? (
            <Text style={[styles.count, { color: colors.mutedForeground }]}>
              {search.results.length} result{search.results.length === 1 ? "" : "s"}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: 12, paddingTop: 8, paddingHorizontal: 20, paddingBottom: 8 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  input: { flex: 1, fontSize: 17, paddingVertical: 11 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 },
  statusText: { fontSize: 13 },
  count: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 8 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
});
