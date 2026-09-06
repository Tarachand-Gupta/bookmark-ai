import { useEffect } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { BookmarkRow } from "../components/BookmarkRow";
import { HomeActivityRow } from "../components/HomeActivityRow";
import { HomeContinueCard } from "../components/HomeContinueCard";
import { HomeLiveStrip } from "../components/HomeLiveStrip";
import { HomeSection } from "../components/HomeSection";
import { Symbol } from "../components/Symbol";
import { UpdateBanner } from "../components/UpdateBanner";
import { useAppTheme } from "../context/PreferencesContext";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useDashboard } from "../hooks/useDashboard";
import { useLiveDevices } from "../hooks/useLiveDevices";
import { releaseKey } from "../lib/appUpdate";
import { pickContinueTarget } from "../lib/continueTarget";
import type { NavTarget } from "../navigation/intents";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

/** Rows shown per section (§4.4/§4.5 — the top-N, everything else lives in its
 * own tab). The endpoint sends 8 recents; we show 5. */
const RECENT_ROWS = 5;
const READING_ROWS = 3;

/**
 * The tag the reading queue's "See all" filters the Library by. The queue
 * itself is server-side (`reading`/`article` tagged saves — the native-sync
 * payoff surface); the Library only supports ONE tag filter, so the link uses
 * the canonical one rather than pretending to reproduce the union.
 */
const READING_TAG = "reading";

/**
 * Home tab — the landing screen (docs/features/dashboard.md §4). One scroll
 * column, ranked by "where was I, and what do I do next?": search, the single
 * best resume target, what's live, what just landed, what's queued to read, and
 * one quiet activity line.
 *
 * Every section renders only when it has data, so a fresh account gets a
 * focused first-run pointer instead of five hollow boxes (§1.3).
 */
export function HomeScreen({
  active,
  onNavigate,
  onOpenSettings,
  refreshSignal = 0,
}: {
  /** Home is the foreground tab — gates the live stream and the staleness refetch. */
  active: boolean;
  onNavigate: (target: NavTarget) => void;
  /** Settings lost its tab slot to Ask AI, so Home's title row is its entry
   * point (the Shell presents it full-screen — see SettingsPresentation). */
  onOpenSettings: () => void;
  /** Counter bumped by the Shell after a save it owns (a share-sheet save), so
   * "Recently saved" picks it up without waiting out the staleness window. */
  refreshSignal?: number;
}) {
  const { colors, radius } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();
  const dash = useDashboard(active);
  // A newer build published for this platform (§12) — Home is the landing tab
  // and always mounted, so this IS the launch check; the hook also re-checks on
  // foreground and every 6 h.
  const update = useAppUpdate();

  // Same stream the Sessions tab's Live segment uses; it holds the
  // connection only while Home is the foreground tab and the app is active. Any
  // failure leaves `devices` empty and is NEVER surfaced here — the live card
  // and strip simply don't render (§4.2: no error states on the landing page).
  const live = useLiveDevices({ active, segment: "ongoing", expanded: false });

  useEffect(() => {
    if (refreshSignal === 0) return;
    dash.refresh();
    // ...and again once the server's scrape has filled in the title/preview.
    const timer = setTimeout(dash.refresh, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the signal only
  }, [refreshSignal]);

  const data = dash.data;
  const continueTarget = pickContinueTarget({
    devices: live.devices,
    sessions: data?.recentSessions ?? [],
    otherDeviceBookmarks: data?.otherDeviceBookmarks ?? [],
  });

  const recents = data?.recentBookmarks.slice(0, RECENT_ROWS) ?? [];
  const reading = data?.readingQueue.items.slice(0, READING_ROWS) ?? [];
  const readingTotal = data?.readingQueue.total ?? 0;
  const freshAccount =
    data !== null && data.totalBookmarks === 0 && data.totalSessions === 0;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: tabBarClearance }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={dash.refreshing}
          onRefresh={() => {
            dash.refresh();
            live.refresh();
          }}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.largeTitle, { color: colors.foreground }]}>Home</Text>
          {/* The app's only way into Settings now that it isn't a tab: a ghost
              circular button on the title's baseline row, 44pt hit target. */}
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onOpenSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={8}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && { backgroundColor: colors.muted },
            ]}
          >
            <Symbol name="gearshape" size={23} color={colors.foreground} fallback="⚙" />
          </Pressable>
        </View>
        {/*
          Visually the Search tab's field, but a Pressable rather than a real
          TextInput: tapping hands the query straight to the Search tab (which
          owns the debounce, the hybrid request, and the results). A second live
          input here would mean two query states and a keyboard that opens on the
          wrong screen.
        */}
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            onNavigate({ tab: "search", focus: true });
          }}
          accessibilityRole="search"
          accessibilityLabel="Search your library"
          style={({ pressed }) => [
            styles.field,
            { backgroundColor: colors.muted, borderRadius: radius.lg, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Symbol name="magnifyingglass" size={17} color={colors.mutedForeground} fallback="⌕" />
          <Text style={[styles.fieldText, { color: colors.mutedForeground }]}>
            Titles, tags, questions…
          </Text>
        </Pressable>
      </View>

      {update.banner !== null && (
        // Directly under the header, above everything else on the tab: an update
        // is the one thing worth seeing before "where was I". Keyed by release so
        // a new version re-runs the entrance instead of morphing in place.
        <View style={styles.update}>
          <UpdateBanner
            key={releaseKey(update.banner.release)}
            banner={update.banner}
            onSnooze={update.snooze}
          />
        </View>
      )}

      {continueTarget !== null && (
        <View style={styles.hero}>
          <HomeContinueCard target={continueTarget} onNavigate={onNavigate} />
        </View>
      )}

      {live.devices.length > 0 && (
        <HomeSection title="Live now">
          <HomeLiveStrip
            devices={live.devices}
            onPress={() => onNavigate({ tab: "sessions", segment: "ongoing" })}
          />
        </HomeSection>
      )}

      {data === null ? (
        dash.loading ? (
          <Skeletons />
        ) : (
          <LoadFailed message={dash.error} />
        )
      ) : freshAccount ? (
        <FirstRun onAdd={() => onNavigate({ tab: "library", add: true })} />
      ) : (
        <>
          {recents.length > 0 && (
            <HomeSection
              title="Recent saves"
              actionLabel="See all"
              onAction={() => onNavigate({ tab: "library" })}
            >
              {recents.map((bookmark, i) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  last={i === recents.length - 1}
                />
              ))}
            </HomeSection>
          )}

          {readingTotal > 0 && reading.length > 0 && (
            <HomeSection
              title={`Reading queue · ${readingTotal}`}
              actionLabel="See all"
              onAction={() => onNavigate({ tab: "library", tag: READING_TAG })}
            >
              {reading.map((bookmark, i) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  last={i === reading.length - 1}
                />
              ))}
            </HomeSection>
          )}

          {data.activity !== null && (
            <View style={styles.activity}>
              <HomeActivityRow activity={data.activity} />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Fixed-height placeholders so the real cards land without a layout jump (§5). */
function Skeletons() {
  const { colors, radius } = useAppTheme();
  const block = (height: number) => (
    <View style={{ height, borderRadius: radius.lg, backgroundColor: colors.muted }} />
  );
  return (
    <View style={styles.skeletons} accessibilityLabel="Loading">
      {block(68)}
      {block(44)}
      {block(44)}
      {block(44)}
    </View>
  );
}

/**
 * Nothing cached and the fetch failed. Deliberately small and blame-free —
 * pull-to-refresh is the retry, and the search field above still works.
 */
function LoadFailed({ message }: { message: string | null }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.notice}>
      <Text style={[styles.noticeTitle, { color: colors.foreground }]}>Nothing to show yet</Text>
      <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>
        {message ?? "Pull down to try again."}
      </Text>
    </View>
  );
}

/** Empty account: one pointer at the one action that unblocks everything else. */
function FirstRun({ onAdd }: { onAdd: () => void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.firstRun,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <Symbol name="bookmark" size={26} color={colors.mutedForeground} fallback="◇" />
      <Text style={[styles.firstRunTitle, { color: colors.foreground }]}>
        Save your first bookmark
      </Text>
      <Text style={[styles.firstRunBody, { color: colors.mutedForeground }]}>
        Everything you save from any browser or device lands here — with the page's preview,
        category, and tags filled in for you.
      </Text>
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onAdd();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.firstRunButton,
          { backgroundColor: colors.primary, borderRadius: radius.md, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Symbol name="plus" size={15} color={colors.primaryForeground} fallback="＋" weight="semibold" />
        <Text style={[styles.firstRunButtonText, { color: colors.primaryForeground }]}>
          Add a bookmark
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // paddingTop 8 / paddingHorizontal 20 — the exact `header` block Library,
  // Search, Sessions and Settings use, so all five large titles share a baseline.
  header: { gap: 12, paddingTop: 8, paddingHorizontal: 20, paddingBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  // Circular ghost button; negative right margin pulls the GLYPH (not the 44pt
  // box) onto the same 20pt gutter the title and cards sit on.
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
  },
  field: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  // Mirrors SearchScreen's `input` metrics exactly (17pt, 11pt vertical) so the
  // two fields are the same object to the eye.
  fieldText: { flex: 1, fontSize: 17, paddingVertical: 11, letterSpacing: 0 },
  // 8 above (→ 16 from the search field, with the header's own 8) and 8 below,
  // so the hero's paddingTop makes the banner-to-card gap the same 16.
  update: { paddingTop: 8, paddingBottom: 8 },
  hero: { paddingTop: 8 },
  activity: { paddingTop: 22 },
  skeletons: { gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  notice: { alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 48 },
  noticeTitle: { fontSize: 17, fontWeight: "600" },
  noticeBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
  firstRun: {
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 28,
    borderWidth: StyleSheet.hairlineWidth,
  },
  firstRunTitle: { fontSize: 17, fontWeight: "600", marginTop: 4 },
  firstRunBody: { fontSize: 15, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  firstRunButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  firstRunButtonText: { fontSize: 15, fontWeight: "600" },
});
