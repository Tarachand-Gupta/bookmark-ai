import { useEffect, useMemo, useState } from "react";
import { CacheStatus } from "../components/CacheStatus";
import { useOrganization } from "../context/OrganizationContext";
import { useComposer } from "../context/ComposerContext";
import { useBookmarkSelection } from "../hooks/useBookmarkSelection";
import { FolderPicker } from "../components/organization/FolderPicker";
import { Sheet, Action, Copy, styles as organizationStyles } from "../components/organization/OrganizationSheet";
import { GettingStartedCard } from "../components/onboarding/GettingStartedCard";
import { AddBookmarkSheet } from "../components/AddBookmarkSheet";
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
import { useContentWidth } from "../hooks/useContentWidth";
import { useLibrary, type LibraryState } from "../hooks/useLibrary";
import { groupByDay } from "../lib/dayGroups";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

const QUICK_CHIP_LIMIT = 5;

/** Library tab: large title, quick category chips + Filters pill (full facet
 * lists live in a bottom sheet), day-grouped list or a card grid — 2 columns on
 * phones, 3/4 on tablets (portrait/landscape). On tablet widths the LIST sits in
 * the shared centered content column; the GRID keeps the full width and spends
 * it on columns instead, and the header follows whichever is showing. */
export function LibraryScreen({
  active,
  filterSheetOpen,
  onFilterSheetChange,
  addSheetOpen,
  onAddSheetChange,
  addSheetUrl = null,
  requestedTag = null,
  onRequestedTagHandled,
  refreshSignal = 0,
  onBookmarkAdded, onImport, requestedReading, onReadingHandled,
}: {
  /** Foreground-tab flag: gates useLibrary's stale-on-focus refetch. */
  active: boolean;
  filterSheetOpen: boolean;
  onFilterSheetChange: (open: boolean) => void;
  /** The add sheet is Shell state so other tabs can open it (Home's first-run
   * "Add a bookmark" pointer), exactly like the filter sheet. */
  addSheetOpen: boolean;
  onAddSheetChange: (open: boolean) => void;
  /** Prefills the add sheet's link field — set when a share-sheet save failed
   * and the Shell is handing the link back to the user. */
  addSheetUrl?: string | null;
  /** One-shot tag filter from the Shell (Home's "Reading queue → See all").
   * Applied on arrival and cleared, so the user's own filter taps afterwards
   * are never fought over. */
  requestedTag?: string | null;
  onRequestedTagHandled?: () => void;
  /** Counter bumped by the Shell after a save it owns (a share-sheet save) —
   * this list is mounted behind the tab switcher, so it would otherwise sit on
   * stale data for the rest of its 60s staleness window. */
  refreshSignal?: number;
  onBookmarkAdded?: () => void; onImport:()=>void; requestedReading?:string|null; onReadingHandled:()=>void;
}) {
  const { colors } = useAppTheme();
  const { viewMode, setViewMode } = usePreferences();
  const tabBarClearance = useTabBarClearance();
  const { inset, gridColumns } = useContentWidth();
  const onScroll = useTabBarScroll();
  const lib = useLibrary(active);
  const org=useOrganization(),composer=useComposer();
  const selection=useBookmarkSelection("library",active,{query:lib.filters});
  const [folderBrowser,setFolderBrowser]=useState(false);
  useEffect(()=>{composer.block("folder-browser",folderBrowser);return()=>composer.block("folder-browser",false)},[folderBrowser,composer.block]);
  useEffect(()=>{if(requestedReading){lib.clearFilters();lib.setFilterExact("readingState",requestedReading);onReadingHandled()}},[requestedReading]);
  const sections = useMemo(() => groupByDay(lib.bookmarks), [lib.bookmarks]);

  useEffect(() => {
    if (requestedTag === null) return;
    // setFilterExact, not setFilter: arriving with the tag that happens to be
    // active already must keep it, not toggle it off.
    lib.setFilterExact("tag", requestedTag);
    onRequestedTagHandled?.();
  }, [requestedTag, onRequestedTagHandled, lib.setFilterExact]);

  useEffect(() => {
    if (refreshSignal === 0) return;
    lib.refresh();
    // ...and again once the server's scrape has filled in the title/preview,
    // matching what the add sheet does for its own saves.
    const timer = setTimeout(lib.refresh, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the signal only
  }, [refreshSignal]);

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={[styles.largeTitle, { color: colors.foreground }]}>Library</Text>
        <View style={styles.titleActions}>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if(!org.offline)onAddSheetChange(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={org.offline?"Reconnect to add a bookmark":"Add bookmark"}
            disabled={org.offline}
            hitSlop={6}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: pressed ? colors.border : colors.muted },
            ]}
          >
            <Symbol name="plus" size={19} color={colors.foreground} fallback="＋" weight="semibold" />
          </Pressable>
          <SegmentedControl
            segments={[
              { value: "list", symbol: "list.bullet", fallback: "☰" },
              { value: "cards", symbol: "square.grid.2x2", fallback: "▦" },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />
        </View>
      </View>
      {selection.supported&&<><Action label={`Folder: ${org.data?.folders.find(f=>f.id===lib.filters.folderId)?.path??(lib.filters.folderId==='unsorted'?'Unsorted':'All bookmarks')}`} onPress={()=>setFolderBrowser(true)}/><View style={organizationStyles.row}><Action label="All bookmarks" primary={!lib.filters.readingState} onPress={()=>lib.setFilterExact('readingState',undefined)}/><Action label="Reading list" primary={!!lib.filters.readingState} onPress={()=>lib.setFilterExact('readingState','unread')}/></View>{!!lib.filters.readingState&&<View style={organizationStyles.row}>{[{value:'unread',label:'Unread'},{value:'read',label:'Read'},{value:'on_list',label:'All on list'}].map(state=><Action key={state.value} label={state.label} primary={lib.filters.readingState===state.value} onPress={()=>lib.setFilterExact('readingState',state.value)}/>)}</View>}</>}
      <CacheStatus updatedAt={lib.updatedAt} refreshing={lib.refreshing} error={lib.error} readOnly={lib.readOnly} onRetry={lib.refresh}/>
      <QuickFilters lib={lib} onOpenSheet={() => onFilterSheetChange(true)} />
      <Text style={[styles.count, { color: colors.mutedForeground }]}>
        {lib.readOnly ? `${lib.bookmarks.length} saved on this device · ${lib.total} last known total` : `${lib.total} bookmark${lib.total === 1 ? "" : "s"}`}
        {lib.activeFilterCount > 0 ? " · filtered" : ""}
      </Text>
    </View>
  );

  const empty = lib.loading ? (
    <ActivityIndicator style={styles.empty} color={colors.mutedForeground} />
  ) : !lib.error && !lib.readOnly && lib.activeFilterCount===0 ? <View style={{padding:20}}><GettingStartedCard onSaveLink={()=>{if(!org.offline)onAddSheetChange(true)}} onImport={()=>{if(!org.offline)onImport()}}/></View> : (
    <View style={styles.empty}>
      <Symbol name="bookmark" size={28} color={colors.mutedForeground} fallback="◇" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {lib.error ? "Could not load" : "Nothing here"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {lib.readOnly?"No on-device snapshot for this view yet. Reconnect to load these bookmarks.":lib.error ?? "Adjust the filters, or save a link."}
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
      {selection.controls}
      {viewMode === "list" ? (
        <SectionList
          sections={sections}
          keyExtractor={(b: Bookmark) => b.id}
          renderItem={({ item, index, section }) => (
            <BookmarkRow bookmark={item} last={index === section.data.length - 1} selecting={selection.selecting} selected={selection.ids.includes(item.id)} onSelect={selection.toggle} />
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
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: inset }}
        />
      ) : (
        <FlatList
          // FlatList can't change numColumns in place (RN documents the key
          // remount) — a rotation between 3 and 4 columns re-creates the list.
          key={`grid-${gridColumns}`}
          data={lib.bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BookmarkCard bookmark={item} selecting={selection.selecting} selected={selection.ids.includes(item.id)} onSelect={selection.toggle} />}
          numColumns={gridColumns}
          columnWrapperStyle={styles.cardRow}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          refreshControl={refreshControl}
          onEndReached={lib.loadMore}
          onEndReachedThreshold={0.4}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
        />
      )}
      {folderBrowser&&<Sheet visible title="Browse folders" onClose={()=>setFolderBrowser(false)}><Action label="All bookmarks" onPress={()=>{lib.setFilterExact("folderId",undefined);setFolderBrowser(false)}}/><FolderPicker value={lib.filters.folderId??null} label="Browse here" onCancel={()=>setFolderBrowser(false)} onChoose={id=>{lib.setFilterExact("folderId",id??"unsorted");setFolderBrowser(false)}}/>{lib.filters.folderId&&lib.filters.folderId!=="unsorted"&&<Action label="Ask AI about this folder" onPress={()=>{setFolderBrowser(false);composer.open({type:"folder",folderId:lib.filters.folderId!,includeSubfolders:true})}}/>}</Sheet>}
      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => onFilterSheetChange(false)}
        meta={lib.meta}
        filters={lib.filters}
        onFilter={lib.setFilter}
        onClear={lib.clearFilters}
      />
      <AddBookmarkSheet
        visible={addSheetOpen}
        initialUrl={addSheetUrl}
        onClose={() => onAddSheetChange(false)}
        onSaved={() => {
          onBookmarkAdded?.();
          lib.refresh();
          // the server scrapes the page's title/preview just after the save
          // returns — pick those up without a manual pull-to-refresh
          setTimeout(lib.refresh, 4000);
        }}
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
  header: { gap: 14, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
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
  // horizontal padding lives here (not on the list container) so the shared
  // header keeps identical insets in list and grid view
  cardRow: { gap: 12, marginBottom: 12, paddingHorizontal: 20 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 300, textAlign: "center", lineHeight: 20 },
});
