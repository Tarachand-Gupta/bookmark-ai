import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import { CHAT_SAMPLE_PROMPTS } from "../../lib/chatPrompts";
import { Symbol } from "../Symbol";

/**
 * The empty thread's "try asking" chips. Tapping one SENDS it — the user picked a
 * complete question, and making them tap again in the composer would be busywork
 * (same call the web makes).
 */
export function ChatSamplePrompts({ onPick }: { onPick: (text: string) => void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>TRY ASKING</Text>
      {CHAT_SAMPLE_PROMPTS.map((prompt) => (
        <Pressable
          key={prompt.id}
          onPress={() => onPick(prompt.text)}
          accessibilityRole="button"
          accessibilityLabel={prompt.text}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: pressed ? colors.muted : colors.card,
              borderColor: colors.border,
              borderRadius: radius.lg,
            },
          ]}
        >
          <Symbol
            name={prompt.symbol}
            size={15}
            color={colors.mutedForeground}
            fallback={prompt.fallback}
          />
          <Text style={[styles.text, { color: colors.foreground }]}>{prompt.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingHorizontal: 16 },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, paddingLeft: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, fontSize: 15, lineHeight: 20 },
});
