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
import { SegmentedControl } from "../components/SegmentedControl";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useSearch } from "../hooks/useSearch";
import { useTabBarClearance } from "../navigation/TabBar";

/** Search tab: iOS search field with clear ✕, Text/AI segmented switch,
 * results as standard rows. */
export function SearchScreen() {
  const { colors, radius } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
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
        <View style={styles.modeRow}>
          <SegmentedControl
            segments={[
              { value: "text", label: "Keyword" },
              { value: "ai", label: "AI · Semantic" },
            ]}
            value={search.mode}
            onChange={search.setMode}
          />
          {search.searching && <ActivityIndicator size="small" color={colors.mutedForeground} />}
        </View>
      </View>

      <FlatList
        data={search.results}
        keyExtractor={(b) => b.id}
        renderItem={({ item, index }) => (
          <BookmarkRow bookmark={item} last={index === search.results.length - 1} />
        )}
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
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
                  {search.error ??
                    (search.mode === "text"
                      ? "Try AI · Semantic — it matches meaning, not just words."
                      : "Try different phrasing.")}
                </Text>
              </>
            ) : !hasQuery ? (
              <>
                <Symbol name="sparkles" size={28} color={colors.mutedForeground} fallback="✦" />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Search your library
                </Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  Keyword finds exact words. AI · Semantic understands questions like “that tool
                  for tracing LLM calls”.
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
  modeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 8 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
});
