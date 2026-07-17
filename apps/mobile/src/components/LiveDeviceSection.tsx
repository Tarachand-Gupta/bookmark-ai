import { StyleSheet, Text, View } from "react-native";
import type { LiveDevice, LiveWindow } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";
import { ageLabel, deviceDisplayLabel, deviceGlyph, deviceHeading, isStale } from "../lib/live";
import { LiveWindowCard } from "./LiveWindowCard";
import { Symbol } from "./Symbol";

/**
 * One device as a plain section header (dot + icon + heading + "as of X ago")
 * over its window cards — the header carries no card chrome, so the windows
 * read as the nested level without a third box. Freshness is the server's
 * integer age only (§4.4): a filled dot when fresh, hollow + dimmed when stale.
 */
export function LiveDeviceSection({
  device,
  isWindowExpanded,
  onToggleWindow,
  savingKey,
  onSaveWindow,
}: {
  device: LiveDevice;
  isWindowExpanded: (windowId: number) => boolean;
  onToggleWindow: (windowId: number) => void;
  savingKey: string | null;
  onSaveWindow: (window: LiveWindow, windowNumber: number) => void;
}) {
  const { colors } = useAppTheme();
  const stale = isStale(device.lastSeenAgeSeconds);
  const glyph = deviceGlyph(device.device);
  const label = deviceDisplayLabel(device);

  return (
    <View style={styles.section}>
      <View style={[styles.header, stale && { opacity: 0.7 }]}>
        <View
          style={[
            styles.dot,
            stale
              ? { borderColor: colors.mutedForeground, borderWidth: 1.5 }
              : { backgroundColor: colors.foreground },
          ]}
        />
        <Symbol name={glyph.name} size={15} color={colors.mutedForeground} fallback={glyph.fallback} />
        <View style={styles.headerTexts}>
          <Text numberOfLines={1} style={[styles.heading, { color: colors.foreground }]}>
            {deviceHeading(device)}
          </Text>
          <Text style={[styles.age, { color: colors.mutedForeground }]}>
            as of {ageLabel(device.lastSeenAgeSeconds)}
          </Text>
        </View>
      </View>

      {device.windows.map((win, index) => {
        const number = index + 1;
        return (
          <LiveWindowCard
            key={win.windowId}
            win={win}
            windowNumber={number}
            deviceLabel={label}
            stale={stale}
            expanded={isWindowExpanded(win.windowId)}
            onToggle={() => onToggleWindow(win.windowId)}
            saving={savingKey === `${device.deviceId}:${win.windowId}`}
            onSave={() => onSaveWindow(win, number)}
          />
        );
      })}

      {device.hiddenTabCount > 0 && (
        <Text style={[styles.hidden, { color: colors.mutedForeground }]}>
          {device.hiddenTabCount} tab{device.hiddenTabCount === 1 ? "" : "s"} not shown (private or
          local)
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 8, paddingBottom: 4 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  headerTexts: { flex: 1, gap: 1 },
  heading: { fontSize: 15, fontWeight: "600" },
  age: { fontSize: 13 },
  hidden: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 8,
  },
});
