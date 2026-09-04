import { StyleSheet, Text, View } from "react-native";
import { AI_NOTE_OWN_KEY_INCOMPLETE, AI_SOURCE_FALLBACK_NOTE } from "@bookmark-ai/types";
import { useAppTheme } from "../../context/PreferencesContext";
import { Symbol } from "../Symbol";

/**
 * One muted line under an assistant reply about WHICH key answered:
 *  - `own-fallback` (`X-Ai-Source`): this week's free credits are gone, so chat
 *    ran on the user's saved key instead of stopping at a paywall;
 *  - `own-key-incomplete` (`X-Ai-Note`): a key is saved but has no model, so the
 *    turn ran on the included AI — choosing a model is a web-app flow.
 * Copy is the shared contract's.
 */
export function ChatSourceNote({ kind }: { kind: "own-fallback" | "own-key-incomplete" }) {
  const { colors } = useAppTheme();
  const fallback = kind === "own-fallback";
  return (
    <View style={styles.row} accessibilityRole="text">
      <Symbol
        name={fallback ? "key" : "exclamationmark.circle"}
        size={12}
        color={colors.mutedForeground}
        fallback={fallback ? "⚿" : "!"}
      />
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        {fallback ? AI_SOURCE_FALLBACK_NOTE : AI_NOTE_OWN_KEY_INCOMPLETE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 16 },
  text: { flex: 1, fontSize: 12, lineHeight: 17 },
});
