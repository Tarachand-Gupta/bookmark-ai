import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";

export type ViewMode = "list" | "cards";

/** Row/card layout switch — segmented, like the web header's view toggle. */
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
      {(
        [
          { value: "list", glyph: "☰" },
          { value: "cards", glyph: "▦" },
        ] as const
      ).map(({ value, glyph }) => (
        <Pressable
          key={value}
          onPress={() => onChange(value)}
          accessibilityRole="button"
          accessibilityLabel={value === "list" ? "List view" : "Card view"}
          accessibilityState={{ selected: mode === value }}
          style={[
            styles.btn,
            { borderRadius: radius.sm },
            mode === value && { backgroundColor: colors.card },
          ]}
        >
          <Text
            style={{
              fontSize: 14,
              color: mode === value ? colors.foreground : colors.mutedForeground,
            }}
          >
            {glyph}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", padding: 2 },
  btn: { paddingHorizontal: 10, paddingVertical: 5 },
});
