import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { SearchMode } from "@bookmark-ai/types";
import { useTheme } from "../theme";

/** Search input with a clear ✕ and, while a query is active, the same
 * Text / AI mode switch the web app has. */
export function SearchBar({
  query,
  mode,
  onQueryChange,
  onModeChange,
}: {
  query: string;
  mode: SearchMode;
  onQueryChange: (q: string) => void;
  onModeChange: (m: SearchMode) => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radius.lg,
          },
        ]}
      >
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search bookmarks…"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: colors.foreground }]}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => onQueryChange("")}
            hitSlop={8}
            accessibilityLabel="Clear search"
            style={styles.clear}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>✕</Text>
          </Pressable>
        )}
      </View>
      {query.trim().length > 0 && (
        <View style={[styles.modes, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
          {(["text", "ai"] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => onModeChange(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
              style={[
                styles.modeBtn,
                { borderRadius: radius.sm },
                mode === m && { backgroundColor: colors.card },
              ]}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: mode === m ? "600" : "400",
                  color: mode === m ? colors.foreground : colors.mutedForeground,
                }}
              >
                {m === "text" ? "Text" : "AI"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  inputRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    // Matches the web search input: quiet border + a whisper of elevation.
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  input: { flex: 1, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  clear: { paddingHorizontal: 10, paddingVertical: 8 },
  modes: { flexDirection: "row", padding: 2 },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
});
