import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Bookmark } from "@bookmark-ai/types";
import { BookmarkRow } from "../components/BookmarkRow";
import { SegmentedControl } from "../components/SegmentedControl";
import { SessionCard } from "../components/SessionCard";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useSearch } from "../hooks/useSearch";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

/** Search tab: one iOS search field — hybrid results arrive sectioned:
 * exact keyword matches up top, semantic "related" results behind a toggle
 * so a single search never reads as a wall of results. */
export function SearchScreen() {
  const { colors, radius } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();
  const search = useSearch();
  const hasQuery = search.query.trim().length > 0;

  const [showRelated, setShowRelated] = useState(false);
  // Both result kinds → a tab per kind, Bookmarks default.
  const [resultsTab, setResultsTab] = useState<"bookmarks" | "sessions">("bookmarks");
  useEffect(() => {
    setShowRelated(false);
    setResultsTab("bookmarks");
  }, [search.query]);

  // No keyword hits → the closest semantic matches ARE the results.
  const noExact = search.matches.length === 0 && search.related.length > 0;
  const relatedVisible = noExact || showRelated;

  const sections: { key: "matches" | "related"; data: Bookmark[] }[] = [];
  if (search.matches.length > 0) sections.push({ key: "matches", data: search.matches });
  if (search.related.length > 0)
    sections.push({ key: "related", data: relatedVisible ? search.related : [] });

  const hasSessionResults = hasQuery && search.sessions.length > 0;
  const showingSessions = hasSessionResults && resultsTab === "sessions";
  const bookmarkCount = noExact ? search.related.length : search.matches.length;

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
        {hasSessionResults && (
          <SegmentedControl
            segments={[
              { value: "bookmarks", label: `Bookmarks · ${bookmarkCount}` },
              { value: "sessions", label: `Sessions · ${search.sessions.length}` },
            ]}
            value={resultsTab}
            onChange={setResultsTab}
          />
        )}
      </View>

      {showingSessions ? (
        <FlatList
          data={search.sessions}
          keyExtractor={(s) => s.id}
          keyboardDismissMode="on-drag"
          onScrollBeginDrag={Keyboard.dismiss}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: tabBarClearance }}
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              matchQuery={search.query}
              // open on the matches, like a diff opens on its hunks
              initialExpanded
            />
          )}
        />
      ) : (
      <SectionList
        sections={sections}
        keyExtractor={(b) => b.id}
        renderItem={({ item, index, section }) => (
          <BookmarkRow bookmark={item} last={index === section.data.length - 1} />
        )}
        renderSectionHeader={({ section }) =>
          section.key === "matches" ? (
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {search.matches.length} MATCH{search.matches.length === 1 ? "" : "ES"}
            </Text>
          ) : noExact ? (
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              NO EXACT MATCHES — CLOSEST BY MEANING
            </Text>
          ) : (
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                setShowRelated((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: showRelated }}
              style={({ pressed }) => [
                styles.relatedToggle,
                {
                  backgroundColor: pressed ? colors.muted : colors.card,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Text style={{ fontSize: 15, fontWeight: "500", color: colors.foreground }}>
                {showRelated
                  ? "Hide related results"
                  : `Show ${search.related.length} related result${search.related.length === 1 ? "" : "s"}`}
              </Text>
              <Symbol
                name={showRelated ? "chevron.up" : "chevron.down"}
                size={13}
                color={colors.mutedForeground}
                fallback={showRelated ? "⌃" : "⌄"}
              />
            </Pressable>
          )
        }
        stickySectionHeadersEnabled={false}
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
      />
      )}
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
  // letterSpacing: 0 is explicit, not a default — iOS leaks the tracked
  // attribute from the sign-in OTP field (letterSpacing 6) into every later
  // TextInput, so the placeholder renders as "T i t l e s ,   t a g s …".
  input: { flex: 1, fontSize: 17, paddingVertical: 11, letterSpacing: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 },
  statusText: { fontSize: 13 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  relatedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
    marginHorizontal: 20,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
});
