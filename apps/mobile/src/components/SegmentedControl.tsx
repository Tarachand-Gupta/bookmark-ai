import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";
import type { SymbolViewProps } from "expo-symbols";

export type ViewMode = "list" | "cards";

export interface Segment<T extends string> {
  value: T;
  label?: string;
  symbol?: SymbolViewProps["name"];
  fallback?: string;
}

/** iOS-style segmented control (muted track, raised selected segment). */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => {
              if (!selected) {
                void Haptics.selectionAsync();
                onChange(segment.value);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              styles.segment,
              { borderRadius: radius.sm },
              selected && { backgroundColor: colors.card, ...styles.selectedShadow },
            ]}
          >
            {segment.symbol && (
              <Symbol
                name={segment.symbol}
                size={15}
                color={selected ? colors.foreground : colors.mutedForeground}
                fallback={segment.fallback}
              />
            )}
            {segment.label && (
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: selected ? "600" : "400",
                  color: selected ? colors.foreground : colors.mutedForeground,
                }}
              >
                {segment.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", padding: 2, alignSelf: "flex-start" },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  selectedShadow: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
