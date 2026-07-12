import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkCard } from "../components/BookmarkCard";
import { BookmarkRow } from "../components/BookmarkRow";
import { FilterSheet } from "../components/FilterSheet";
import { SegmentedControl } from "../components/SegmentedControl";
import { Symbol } from "../components/Symbol";
import { useAppTheme, usePreferences } from "../context/PreferencesContext";
import { useLibrary, type LibraryState } from "../hooks/useLibrary";
import { groupByDay } from "../lib/dayGroups";
import { useTabBarClearance } from "../navigation/TabBar";

const QUICK_CHIP_LIMIT = 5;

/** Library tab: large title, quick category chips + Filters pill (full facet
 * lists live in a bottom sheet), day-grouped list or 2-column card grid. */
export function LibraryScreen({
  filterSheetOpen,
  onFilterSheetChange,
}: {
  filterSheetOpen: boolean;
  onFilterSheetChange: (open: boolean) => void;
}) {
  const { colors } = useAppTheme();
  const { viewMode, setViewMode } = usePreferences();
  const tabBarClearance = useTabBarClearance();
  const lib = useLibrary();
  const sections = useMemo(() => groupByDay(lib.bookmarks), [lib.bookmarks]);

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={[styles.largeTitle, { color: colors.foreground }]}>Library</Text>
        <SegmentedControl
          segments={[
            { value: "list", symbol: "list.bullet", fallback: "☰" },
            { value: "cards", symbol: "square.grid.2x2", fallback: "▦" },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
      </View>
      <QuickFilters lib={lib} onOpenSheet={() => onFilterSheetChange(true)} />
      <Text style={[styles.count, { color: colors.mutedForeground }]}>
        {lib.total} bookmark{lib.total === 1 ? "" : "s"}
        {lib.activeFilterCount > 0 ? " · filtered" : ""}
      </Text>
    </View>
  );

  const empty = lib.loading ? (
    <ActivityIndicator style={styles.empty} color={colors.mutedForeground} />
  ) : (
    <View style={styles.empty}>
      <Symbol name="bookmark" size={28} color={colors.mutedForeground} fallback="◇" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {lib.error ? "Could not load" : "Nothing here"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {lib.error ?? "Adjust the filters, or save something from the browser extension."}
      </Text>
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={lib.refreshing}
      onRefresh={lib.refresh}
      tintColor={colors.mutedForeground}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {viewMode === "list" ? (
        <SectionList
          sections={sections}
          keyExtractor={(b: Bookmark) => b.id}
          renderItem={({ item, index, section }) => (
            <BookmarkRow bookmark={item} last={index === section.data.length - 1} />
          )}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          refreshControl={refreshControl}
          onEndReached={lib.loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
        />
      ) : (
        <FlatList
          data={lib.bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BookmarkCard bookmark={item} />}
          numColumns={2}
          columnWrapperStyle={styles.cardRow}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          refreshControl={refreshControl}
          onEndReached={lib.loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={[styles.gridContent, { paddingBottom: tabBarClearance }]}
        />
      )}
      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => onFilterSheetChange(false)}
        meta={lib.meta}
        filters={lib.filters}
        onFilter={lib.setFilter}
        onClear={lib.clearFilters}
      />
    </View>
  );
}

/** One horizontal rail: Filters pill (with active-count badge) + the top
 * categories for one-tap filtering. Everything else lives in the sheet. */
function QuickFilters({ lib, onOpenSheet }: { lib: LibraryState; onOpenSheet: () => void }) {
  const { colors } = useAppTheme();
  const quick = (lib.meta?.categories ?? []).slice(0, QUICK_CHIP_LIMIT);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onOpenSheet();
        }}
        accessibilityRole="button"
        style={[
          styles.filterPill,
          {
            backgroundColor: lib.activeFilterCount > 0 ? colors.primary : colors.card,
            borderColor: lib.activeFilterCount > 0 ? colors.primary : colors.border,
          },
        ]}
      >
        <Symbol
          name="line.3.horizontal.decrease"
          size={14}
          color={lib.activeFilterCount > 0 ? colors.primaryForeground : colors.foreground}
          fallback="≡"
        />
        <Text
          style={{
            fontSize: 15,
            fontWeight: "500",
            color: lib.activeFilterCount > 0 ? colors.primaryForeground : colors.foreground,
          }}
        >
          Filters{lib.activeFilterCount > 0 ? ` · ${lib.activeFilterCount}` : ""}
        </Text>
      </Pressable>
      {quick.map((c) => {
        const selected = lib.filters.category === c.name;
        return (
          <Pressable
            key={c.name}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              lib.setFilter("category", c.name);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={{ fontSize: 15, color: selected ? colors.primaryForeground : colors.foreground }}
            >
              {c.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gridContent: { paddingHorizontal: 20 },
  header: { gap: 14, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  rail: { flexDirection: "row", gap: 8, paddingRight: 20 },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  count: { fontSize: 13 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 6,
  },
  cardRow: { gap: 12, marginBottom: 12 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 300, textAlign: "center", lineHeight: 20 },
});
