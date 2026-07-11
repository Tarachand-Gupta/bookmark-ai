import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkCard } from "../components/BookmarkCard";
import { BookmarkRow } from "../components/BookmarkRow";
import { FilterRails } from "../components/FilterRails";
import { SearchBar } from "../components/SearchBar";
import { ViewToggle, type ViewMode } from "../components/ViewToggle";
import { useLibrary } from "../hooks/useLibrary";
import { useTheme } from "../theme";

export function LibraryScreen() {
  const { colors } = useTheme();
  const lib = useLibrary();
  const [view, setView] = useState<ViewMode>("list");
  const isSearch = lib.query.trim().length > 0;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>Bookmark AI</Text>
        <ViewToggle mode={view} onChange={setView} />
      </View>
      <SearchBar
        query={lib.query}
        mode={lib.mode}
        onQueryChange={lib.setQuery}
        onModeChange={lib.setMode}
      />
      {!isSearch && <FilterRails meta={lib.meta} filters={lib.filters} onFilter={lib.setFilter} />}
      <Text style={[styles.count, { color: colors.mutedForeground }]}>
        {lib.searching
          ? "Searching…"
          : isSearch
            ? `${lib.total} result${lib.total === 1 ? "" : "s"}`
            : `${lib.total} bookmark${lib.total === 1 ? "" : "s"}`}
      </Text>
    </View>
  );

  const empty = lib.loading ? (
    <ActivityIndicator style={styles.empty} color={colors.mutedForeground} />
  ) : lib.error ? (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Could not load</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{lib.error}</Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {isSearch ? "No matches" : "No bookmarks yet"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {isSearch
          ? "Try a different phrasing, or switch between Text and AI search."
          : "Save something from the browser extension and pull to refresh."}
      </Text>
    </View>
  );

  const renderItem = ({ item }: { item: Bookmark }) =>
    view === "cards" ? <BookmarkCard bookmark={item} /> : <BookmarkRow bookmark={item} />;

  return (
    <FlatList
      // numColumns can't change on a live list — remount per view mode.
      key={view}
      data={lib.bookmarks}
      keyExtractor={(b) => b.id}
      renderItem={renderItem}
      numColumns={view === "cards" ? 2 : 1}
      columnWrapperStyle={view === "cards" ? styles.cardRow : undefined}
      contentContainerStyle={[styles.content, { backgroundColor: colors.background }]}
      style={{ backgroundColor: colors.background }}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      refreshControl={
        <RefreshControl
          refreshing={lib.refreshing}
          onRefresh={lib.refresh}
          tintColor={colors.mutedForeground}
        />
      }
      onEndReached={lib.loadMore}
      onEndReachedThreshold={0.4}
      keyboardDismissMode="on-drag"
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 0 },
  header: { gap: 12, paddingBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  count: { fontSize: 12 },
  cardRow: { gap: 12, marginBottom: 12 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 64 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyBody: { fontSize: 13, maxWidth: 280, textAlign: "center" },
});
