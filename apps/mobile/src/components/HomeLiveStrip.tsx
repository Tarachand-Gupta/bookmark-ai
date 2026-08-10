import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { LiveDevice } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";
import { deviceDisplayLabel, deviceGlyph, isStale } from "../lib/live";
import { PulseDot, StaleDot } from "./PulseDot";
import { Symbol } from "./Symbol";

/**
 * "Live now": one chip per device currently mirroring its tabs (§4.3). Renders
 * nothing at all when no device is live — including when the live server is off
 * or unreachable, which the caller passes as an empty list. Home never shows a
 * live error; the absence IS the message.
 */
export function HomeLiveStrip({
  devices,
  onPress,
}: {
  devices: LiveDevice[];
  /** Sessions tab → Ongoing segment (where the tabs live). */
  onPress: () => void;
}) {
  const { colors, radius } = useAppTheme();
  if (devices.length === 0) return null;

  // Freshest first, so the chip you most likely want is under your thumb.
  const ordered = [...devices].sort((a, b) => a.lastSeenAgeSeconds - b.lastSeenAgeSeconds);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {ordered.map((device) => {
        const stale = isStale(device.lastSeenAgeSeconds);
        const glyph = deviceGlyph(device.device);
        return (
          <Pressable
            key={device.deviceId}
            onPress={() => {
              void Haptics.selectionAsync();
              onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${deviceDisplayLabel(device)}, ${device.tabCount} tabs live`}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: pressed ? colors.muted : colors.card,
                borderColor: colors.border,
                borderRadius: radius.xl,
                opacity: stale ? 0.7 : 1,
              },
            ]}
          >
            {stale ? (
              <StaleDot size={7} color={colors.mutedForeground} />
            ) : (
              <PulseDot size={7} color={colors.foreground} />
            )}
            <Symbol
              name={glyph.name}
              size={14}
              color={colors.mutedForeground}
              fallback={glyph.fallback}
            />
            <Text numberOfLines={1} style={[styles.label, { color: colors.foreground }]}>
              {deviceDisplayLabel(device)}
            </Text>
            <View style={[styles.countPill, { backgroundColor: colors.muted }]}>
              <Text style={[styles.count, { color: colors.mutedForeground }]}>
                {device.tabCount}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 260,
  },
  label: { fontSize: 15, fontWeight: "500", flexShrink: 1 },
  countPill: {
    minWidth: 22,
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  count: { fontSize: 13, fontWeight: "600" },
});
