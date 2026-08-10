import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { SymbolViewProps } from "expo-symbols";
import { useAppTheme } from "../context/PreferencesContext";
import { openBookmark } from "../lib/bookmarkActions";
import { ageLabel, browserLabel, deviceGlyph, deviceHeading, isStale } from "../lib/live";
import type { ContinueTarget } from "../lib/continueTarget";
import type { NavTarget } from "../navigation/intents";
import { dateLabel } from "./SessionCard";
import { PulseDot, StaleDot } from "./PulseDot";
import { Symbol } from "./Symbol";

interface Presentation {
  /** Honest state line — "Active now", never "Active now" for a 3-hour-old device. */
  kicker: string;
  title: string;
  detail: string;
  glyph: { name: SymbolViewProps["name"]; fallback: string };
  dot: "live" | "stale" | null;
  onPress: () => void;
}

/**
 * The hero card: one resume target, one tap (docs/features/dashboard.md §4.2).
 * Every variant labels itself honestly about *what* it is resuming and *when*
 * that was, because "Continue" is worthless if it lies about freshness.
 */
export function HomeContinueCard({
  target,
  onNavigate,
}: {
  target: ContinueTarget;
  onNavigate: (target: NavTarget) => void;
}) {
  const { colors, radius } = useAppTheme();

  const present = (): Presentation => {
    if (target.kind === "live") {
      const { device } = target;
      const stale = isStale(device.lastSeenAgeSeconds);
      const windows = device.windows.length;
      return {
        kicker: stale ? `Earlier on ${browserLabel(device.browser)}` : "Active now",
        title: deviceHeading(device),
        detail: [
          `${device.tabCount} tab${device.tabCount === 1 ? "" : "s"}${
            windows > 1 ? ` in ${windows} windows` : ""
          }`,
          ageLabel(device.lastSeenAgeSeconds),
        ].join(" · "),
        glyph: deviceGlyph(device.device),
        dot: stale ? "stale" : "live",
        // The Ongoing segment is where the tabs actually are.
        onPress: () => onNavigate({ tab: "sessions", segment: "ongoing" }),
      };
    }
    if (target.kind === "session") {
      const { session } = target;
      const saved = dateLabel(session.savedAt);
      return {
        kicker: "Pick up where you left off",
        title: session.name.trim() || "Untitled session",
        detail: [
          `${session.tabCount} tab${session.tabCount === 1 ? "" : "s"}`,
          saved ? `saved ${saved}` : null,
          browserLabel(session.browser),
        ]
          .filter((part): part is string => part !== null)
          .join(" · "),
        glyph: { name: "square.stack", fallback: "▣" },
        dot: null,
        onPress: () => onNavigate({ tab: "sessions", segment: "saved" }),
      };
    }
    const { bookmark } = target;
    const where = bookmark.source.deviceName?.trim() || browserLabel(bookmark.source.browser);
    return {
      kicker: `Earlier on ${where}`,
      title: bookmark.title,
      detail: bookmark.domain,
      glyph: deviceGlyph(bookmark.source.device),
      dot: null,
      onPress: () => openBookmark(bookmark),
    };
  };

  const { kicker, title, detail, glyph, dot, onPress } = present();

  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole={target.kind === "bookmark" ? "link" : "button"}
      accessibilityLabel={`${kicker}. ${title}. ${detail}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.muted : colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
        },
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
        <Symbol name={glyph.name} size={20} color={colors.foreground} fallback={glyph.fallback} />
      </View>
      <View style={styles.texts}>
        <View style={styles.kickerRow}>
          {dot === "live" && <PulseDot color={colors.foreground} />}
          {dot === "stale" && <StaleDot color={colors.mutedForeground} />}
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>{kicker}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.detail, { color: colors.mutedForeground }]}>
          {detail}
        </Text>
      </View>
      <Symbol name="chevron.right" size={14} color={colors.mutedForeground} fallback="›" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconTile: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  texts: { flex: 1, gap: 2 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { fontSize: 13, fontWeight: "500", letterSpacing: 0.1 },
  title: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  detail: { fontSize: 13 },
});
