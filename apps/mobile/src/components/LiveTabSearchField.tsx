import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";

/**
 * The Live segment's filter field. Same field chrome as the Search tab's
 * (muted pill, leading magnifier, trailing clear) so the two read as one
 * control — but it filters the live snapshot already on screen rather than
 * querying the server, so its placeholder says filter, not search.
 */
export function LiveTabSearchField({
  value,
  onChange,
  matchCount,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Matching tabs across every visible device — shown only while filtering. */
  matchCount: number;
}) {
  const { colors, radius } = useAppTheme();
  const active = value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.lg }]}>
        <Symbol name="magnifyingglass" size={16} color={colors.mutedForeground} fallback="⌕" />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Filter open tabs…"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Filter open tabs"
          // letterSpacing: 0 is explicit for the same reason SearchScreen's is —
          // iOS leaks the sign-in OTP field's tracking into later TextInputs.
          style={[styles.input, { color: colors.foreground }]}
        />
        {active && (
          <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityLabel="Clear tab filter">
            <Symbol name="xmark.circle.fill" size={17} color={colors.mutedForeground} fallback="✕" />
          </Pressable>
        )}
      </View>
      {active && (
        <Text style={[styles.count, { color: colors.mutedForeground }]}>
          {matchCount} matching tab{matchCount === 1 ? "" : "s"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 16, paddingVertical: 9, letterSpacing: 0 },
  count: { fontSize: 13 },
});
