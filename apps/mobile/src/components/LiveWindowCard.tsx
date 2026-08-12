import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { LiveTab, LiveWindow } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";
import { STALE_OPACITY } from "../lib/live";
import { FaviconTile } from "./BookmarkRow";
import { hostOf } from "./SessionCard";
import { Symbol } from "./Symbol";

// A live window is a full browser window (dozens of tabs), not a curated
// snapshot — render only a head slice and fold the rest so an expanded card
// never lays out 40 non-virtualized rows at once (§4.7).
const INITIAL_TABS = 8;

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * One open browser window as a card, mirroring SessionCard's expand / tab-row /
 * fold idioms. Adds a per-window Save (owner: this window only, never all
 * windows) and dims when its device is stale.
 */
export function LiveWindowCard({
  win,
  windowNumber,
  deviceLabel,
  stale,
  expanded,
  onToggle,
  saving,
  onSave,
}: {
  win: LiveWindow;
  windowNumber: number;
  deviceLabel: string;
  stale: boolean;
  expanded: boolean;
  onToggle: () => void;
  saving: boolean;
  onSave: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const [showAll, setShowAll] = useState(false);

  const active = win.tabs.find((t) => t.active) ?? win.tabs[0];
  const subtitle = active ? active.title.trim() || hostOf(active.url) : "No tabs";
  const visible = showAll ? win.tabs : win.tabs.slice(0, INITIAL_TABS);
  const foldedCount = win.tabs.length - visible.length;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
          opacity: stale ? STALE_OPACITY : 1,
        },
      ]}
    >
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.header, pressed && { backgroundColor: colors.muted }]}
      >
        <View style={[styles.badge, { backgroundColor: colors.muted }]}>
          <Symbol name="macwindow" size={18} color={colors.foreground} fallback="▣" />
        </View>
        <View style={styles.titles}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
            Window {windowNumber} · {win.tabs.length} tab{win.tabs.length === 1 ? "" : "s"}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {subtitle}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
          <Symbol name="chevron.right" size={14} color={colors.mutedForeground} fallback="›" />
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={onSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={`Save window ${windowNumber} as a session`}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: colors.primary, borderRadius: radius.md, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.saveLabel, { color: colors.primaryForeground }]}>Save</Text>
          )}
        </Pressable>
      </View>

      {expanded && (
        <>
          {visible.map((tab, index) => (
            <LiveTabRow key={`${index}-${tab.url}`} tab={tab} deviceLabel={deviceLabel} />
          ))}
          {foldedCount > 0 && (
            <Pressable
              onPress={() => {
                void Haptics.selectionAsync();
                setShowAll(true);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.foldRow,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.muted },
              ]}
            >
              <Text style={[styles.foldText, { color: colors.mutedForeground }]}>
                ⋯ {foldedCount} more tab{foldedCount === 1 ? "" : "s"} ⋯
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

/** A tab row. Only real http(s) links tap through; redacted (§5.3) and
 * browser-internal tabs render muted and inert — a live window legitimately
 * holds chrome:// pages the saved-session UI has never had to show. */
function LiveTabRow({ tab, deviceLabel }: { tab: LiveTab; deviceLabel: string }) {
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
        {/* Same 24pt tile the saved-session tab rows use (SessionCard.TabRow) —
            live checkpoints carry each tab's favIconUrl, already narrowed to
            http(s) at capture time by the extension's sanitizeFavicon. */}
        <FaviconTile url={tab.favIconUrl} size={24} />
        <View style={styles.tabTexts}>
          <Text numberOfLines={1} style={[styles.tabTitle, { color: colors.foreground }]}>
            {primary}
          </Text>
          <Text numberOfLines={1} style={[styles.tabHost, { color: colors.mutedForeground }]}>
            {secondary}
          </Text>
        </View>
        <Symbol name="arrow.up.right" size={13} color={colors.mutedForeground} fallback="↗" />
      </Pressable>
    );
  }

  return (
    <View style={[styles.tabRow, { borderTopColor: colors.border }]}>
      {/* Inert rows keep the leading slot so titles stay on one x-axis; a
          browser-internal or redacted tab just shows the neutral fallback. */}
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
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  titles: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: "600" },
  subtitle: { fontSize: 13 },
  actions: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 14, paddingBottom: 12 },
  saveButton: {
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  saveLabel: { fontSize: 14, fontWeight: "600" },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    // 28 + padding 14 + favicon 24 + gap 10 = 76: tab TITLES keep the exact
    // x-position they had before the favicon (62 + 14), icon under the badge —
    // identical arithmetic to SessionCard's saved tab rows.
    marginLeft: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabTexts: { flex: 1, gap: 1 },
  tabTitle: { fontSize: 15 },
  tabHost: { fontSize: 13 },
  foldRow: {
    alignItems: "center",
    paddingVertical: 8,
    marginLeft: 62,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  foldText: { fontSize: 13, fontWeight: "500", letterSpacing: 0.5 },
});
