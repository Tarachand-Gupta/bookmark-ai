import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  FlatLiveTab,
  LiveTabHit,
  LiveTabsToolOutput,
  LiveWindowHit,
  RegroupedLiveDevice,
  ToolPageMeta,
} from "@bookmark-ai/types";
import { listLiveDevices } from "../../../api";
import { useAppTheme } from "../../../context/PreferencesContext";
import { useFold, useTextFilter, useToolPaging } from "../../../hooks/useChatCard";
import {
  deviceTabsLabel,
  flattenLiveDevices,
  hiddenTabsNote,
  hostOf,
  liveTabsNote,
  liveTabsSummary,
  openableUrl,
  pageLiveSnapshot,
  regroupLiveTabs,
  showFilter,
  windowTabsLabel,
  windowTitle,
} from "../../../lib/chatCards";
import { STALE_OPACITY, isStale } from "../../../lib/live";
import { Symbol } from "../../Symbol";
import { CardNote, FilterField, PageFooter, ShowMoreButton, TabFavicon, openCardLink } from "./ChatCardParts";

/**
 * `listLiveTabs` as a card: device sections → window groups → tab rows
 * (favicon, title, host; tap opens). The tool returned ONE page of tabs in flat
 * order, so "Load next 50" re-reads the live snapshot and slices the next page
 * client-side (`pageLiveSnapshot`), appending into the right device/window
 * groups. A filter box narrows what's loaded; each window folds past 10 rows.
 */
export function ChatLiveTabsCard({ output }: { output: LiveTabsToolOutput }) {
  const toolQuery = output.query ?? undefined;
  const fetchPage = useCallback(
    async (offset: number, limit: number): Promise<{ rows: FlatLiveTab[]; page: ToolPageMeta }> =>
      pageLiveSnapshot(await listLiveDevices(), toolQuery, offset, limit),
    [toolQuery],
  );
  const { rows, page, loading, error, loadMore } = useToolPaging(
    flattenLiveDevices(output.devices ?? []),
    output.page,
    fetchPage,
  );
  const { query, setQuery, filtered, active } = useTextFilter(rows, (r) => `${r.tab.title} ${r.tab.url}`);

  const note = liveTabsNote(output, rows.length);
  if (note !== null) return <CardNote>{note}</CardNote>;

  const devices = regroupLiveTabs(filtered);
  const deviceCount = new Set(rows.map((r) => r.device.label)).size;

  return (
    <View>
      {showFilter(rows.length) && (
        <FilterField
          query={query}
          onQuery={setQuery}
          placeholder="Filter tabs by title or site…"
          summary={liveTabsSummary(active, filtered.length, rows.length, page?.total, deviceCount)}
        />
      )}
      {devices.map((device, i) => (
        <DeviceSection key={`${device.label}-${i}`} device={device} first={i === 0} />
      ))}
      {active && filtered.length === 0 && <CardNote>{`No loaded tab matches “${query}”.`}</CardNote>}
      <PageFooter
        page={page}
        firstOffset={output.page?.offset ?? 0}
        shown={rows.length}
        noun="tabs"
        loading={loading}
        error={error}
        onLoadMore={() => void loadMore()}
      />
    </View>
  );
}

/** One device: presence dot, name, browser, "N of M tabs · as of X" — then its windows. */
function DeviceSection({ device, first }: { device: RegroupedLiveDevice; first: boolean }) {
  const { colors } = useAppTheme();
  const stale = isStale(device.lastSeenAgeSeconds);
  const hidden = hiddenTabsNote(device.hiddenTabCount);
  return (
    <View
      style={[
        styles.device,
        !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        stale && { opacity: STALE_OPACITY },
      ]}
    >
      <View style={styles.deviceHeader}>
        <View
          style={[
            styles.dot,
            stale
              ? { borderColor: colors.mutedForeground, borderWidth: 1.5 }
              : { backgroundColor: colors.foreground },
          ]}
        />
        <Text numberOfLines={1} style={[styles.deviceName, { color: colors.foreground }]}>
          {device.label || "Unnamed device"}
        </Text>
        <Text style={[styles.deviceBrowser, { color: colors.mutedForeground }]}>{device.browser}</Text>
      </View>
      <Text style={[styles.deviceMeta, { color: colors.mutedForeground }]}>
        {deviceTabsLabel(device.loadedTabCount, device.tabCount, device.lastSeenAgeSeconds)}
      </Text>

      <View style={styles.windows}>
        {device.windows.map((w, wi) => (
          <WindowGroup key={`${w.windowId ?? wi}`} window={w} index={w.index ?? wi + 1} />
        ))}
      </View>

      {hidden !== null && <Text style={[styles.hiddenNote, { color: colors.mutedForeground }]}>{hidden}</Text>}
    </View>
  );
}

/** One browser window: its name (or "Window N") + tab count, then its tabs, folded past 10. */
function WindowGroup({ window: win, index }: { window: LiveWindowHit; index: number }) {
  const { colors, radius } = useAppTheme();
  const tabs = win.tabs ?? [];
  const total = win.windowTabCount ?? tabs.length;
  const { visibleCount, hidden, expanded, nextChunk, toggle } = useFold(tabs.length);
  return (
    <View style={[styles.window, { borderColor: colors.border, borderRadius: radius.md }]}>
      <View style={[styles.windowHeader, { borderBottomColor: colors.border, backgroundColor: colors.muted }]}>
        <Symbol name="macwindow" size={12} color={colors.mutedForeground} fallback="▭" />
        <Text numberOfLines={1} style={[styles.windowName, { color: colors.foreground }]}>
          {windowTitle(win.name, index)}
        </Text>
        <Text style={[styles.windowCount, { color: colors.mutedForeground }]}>
          {windowTabsLabel(tabs.length, total)}
        </Text>
      </View>
      {tabs.slice(0, visibleCount).map((t, i) => (
        <TabRow key={`${t.url}-${i}`} tab={t} last={i === visibleCount - 1 && hidden === 0 && !expanded} />
      ))}
      {(hidden > 0 || expanded) && (
        <View style={[styles.showMoreWrap, { borderTopColor: colors.border }]}>
          <ShowMoreButton hidden={hidden} expanded={expanded} nextChunk={nextChunk} noun="tab" onToggle={toggle} />
        </View>
      )}
    </View>
  );
}

function TabRow({ tab, last }: { tab: LiveTabHit; last: boolean }) {
  const { colors } = useAppTheme();
  const href = openableUrl(tab.url);
  const title = tab.title || tab.url;
  return (
    <Pressable
      onPress={href ? () => openCardLink(href) : undefined}
      disabled={!href}
      accessibilityRole={href ? "link" : "text"}
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.tabRow,
        !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.muted },
      ]}
    >
      <TabFavicon src={tab.favIconUrl} url={tab.url} />
      <View style={styles.tabTexts}>
        <Text numberOfLines={1} style={[styles.tabTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.tabHost, { color: colors.mutedForeground }]}>
          {hostOf(tab.url)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  device: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 2 },
  deviceHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  deviceName: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  deviceBrowser: { fontSize: 13, textTransform: "capitalize" },
  deviceMeta: { fontSize: 12, fontVariant: ["tabular-nums"], paddingLeft: 16 },
  windows: { gap: 8, marginTop: 8 },
  window: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  windowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  windowName: { fontSize: 13, fontWeight: "600", flex: 1 },
  windowCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  tabRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
  },
  tabTexts: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 14, fontWeight: "500" },
  tabHost: { fontSize: 12 },
  showMoreWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 2 },
  hiddenNote: { fontSize: 12, lineHeight: 16, marginTop: 8 },
});
