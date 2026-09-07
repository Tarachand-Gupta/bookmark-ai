import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import { Symbol } from "../Symbol";
import { ChatSamplePrompts } from "./ChatSamplePrompts";

/**
 * A new thread before the first message, composed VERTICALLY: a small centered
 * intro — what this is for, in one line — with the sample prompts directly under
 * it, as one block. ChatThread centers the block in the free area between the
 * header and the composer, so a tall screen (an iPad) reads as a composed page
 * rather than a bare screen with four pills parked at the bottom; on a short one
 * (a phone with the keyboard up) the block is taller than the area and the
 * thread's stick-to-bottom scroll parks the prompts right above the composer.
 *
 * The prompts themselves (texts, tap-to-send) are ChatSamplePrompts, unchanged.
 */
export function ChatEmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <Symbol name="sparkles" size={28} color={colors.mutedForeground} fallback="✦" />
        <Text style={[styles.title, { color: colors.foreground }]}>Ask about your library</Text>
        {/* One line at 15pt on every width from an iPhone SE up (≈330pt). */}
        <Text style={[styles.lede, { color: colors.mutedForeground }]}>
          Search, count, or summarize what you&apos;ve saved.
        </Text>
      </View>
      <ChatSamplePrompts onPick={onPick} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 28 },
  intro: { alignItems: "center", gap: 6, paddingHorizontal: 24 },
  title: { fontSize: 20, fontWeight: "600", marginTop: 6 },
  lede: { fontSize: 15, lineHeight: 20, textAlign: "center", maxWidth: 340 },
});
