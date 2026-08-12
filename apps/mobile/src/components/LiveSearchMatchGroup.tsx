import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { LiveTab } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";
import type { LiveDeviceMatchGroup } from "../hooks/useLiveSearchMatches";
import { FaviconTile } from "./BookmarkRow";
import { PulseDot } from "./PulseDot";
import { hostOf } from "./SessionCard";
import { Symbol } from "./Symbol";

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * One device's live-tab search matches — its own card, rendered ABOVE the
 * saved-session cards in the Search screen's Sessions segment (see
 * SearchScreen). Deliberately flat and non-collapsible: unlike
 * LiveWindowCard/LiveDeviceSection this never shows a window in full, only
 * the tabs that already matched the query, so there's nothing left to
 * fold/expand — a search result should read as "here's what matched", not
 * invite browsing the rest of the window.
 */
export function LiveSearchMatchGroup({ group }: { group: LiveDeviceMatchGroup }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <View style={styles.deviceHeader}>
        {/* Same neutral "liveness is motion, not a green light" cue used on
            Home/Sessions — this device has a tab open on it RIGHT NOW. */}
        <PulseDot size={7} color={colors.foreground} />
        <Text numberOfLines={1} style={[styles.deviceLabel, { color: colors.foreground }]}>
          {group.deviceLabel}
        </Text>
      </View>
      {group.windows.map((win) => (
        <View key={win.windowId}>
          <Text style={[styles.windowLabel, { color: colors.mutedForeground }]}>
            {win.windowLabel}
          </Text>
          {win.tabs.map((tab, index) => (
            <LiveMatchTabRow
              key={`${win.windowId}-${index}-${tab.url}`}
              tab={tab}
              deviceLabel={group.deviceLabel}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Mirrors LiveWindowCard's own tab row exactly: a real http(s) link opens via
 * `Linking.openURL` — the same call SessionCard's saved-tab rows use, with no
 * haptic on open (only expand/collapse toggles get one, and this row has
 * none to toggle). Redacted or browser-internal tabs render inert, same as
 * the Sessions tab's Live segment.
 */
function LiveMatchTabRow({ tab, deviceLabel }: { tab: LiveTab; deviceLabel: string }) {
  const { colors } = useAppTheme();
  const http = isHttp(tab.url);
  const tappable = http && !tab.redacted;
  const primary = tab.title.trim() || (http ? hostOf(tab.url) : tab.url);
  const secondary = tab.redacted
    ? `link hidden — open on ${deviceLabel}`
    : http
      ? hostOf(tab.url)
      : null;

  if (tappable) {
    return (
      <Pressable
        onPress={() => void Linking.openURL(tab.url)}
        accessibilityRole="link"
        style={({ pressed }) => [
          styles.tabRow,
          { borderTopColor: colors.border },
          pressed && { backgroundColor: colors.border },
        ]}
      >
        {/* Same 24pt FaviconTile as the saved-session and Live-segment tab rows;
            this card is flat (no badge column) so the tile sits at the card's
            own 14pt gutter rather than indented under a header glyph. */}
        <FaviconTile url={tab.favIconUrl} size={24} />
        <View style={styles.tabTexts}>
          <Text numberOfLines={1} style={[styles.tabTitle, { color: colors.foreground }]}>
            {primary}
          </Text>
          {secondary != null && (
            <Text numberOfLines={1} style={[styles.tabHost, { color: colors.mutedForeground }]}>
              {secondary}
            </Text>
          )}
        </View>
        <Symbol name="arrow.up.right" size={13} color={colors.mutedForeground} fallback="↗" />
      </Pressable>
    );
  }

  return (
    <View style={[styles.tabRow, { borderTopColor: colors.border }]}>
      {/* Inert (redacted / browser-internal) rows keep the leading slot so every
          match in the card lines up on one x-axis. */}
      <FaviconTile url={tab.favIconUrl} size={24} />
      <View style={styles.tabTexts}>
        <Text numberOfLines={1} style={[styles.tabTitle, { color: colors.mutedForeground }]}>
          {primary}
        </Text>
        {secondary != null && (
          <Text numberOfLines={1} style={[styles.tabHost, { color: colors.mutedForeground }]}>
            {secondary}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginBottom: 12,
    overflow: "hidden",
  },
  deviceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  deviceLabel: { fontSize: 15, fontWeight: "600", flex: 1 },
  windowLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 2,
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabTexts: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 15 },
  tabHost: { fontSize: 13 },
});
