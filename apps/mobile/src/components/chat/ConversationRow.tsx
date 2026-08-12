import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { ChatConversation } from "@bookmark-ai/types";
import { useAppTheme } from "../../context/PreferencesContext";
import { conversationTimeLabel } from "../../lib/chatFormat";
import { Symbol } from "../Symbol";

/**
 * One conversation in the Ask AI history list: title, when it was last touched,
 * chevron. Tap opens it; LONG-PRESS asks to delete — the same gesture the saved
 * sessions list uses (SessionsScreen → confirmDelete), so there's one delete
 * idiom in the app instead of a swipe here and a long-press there.
 */
export function ConversationRow({
  conversation,
  last,
  onOpen,
  onDelete,
}: {
  conversation: ChatConversation;
  last: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { colors } = useAppTheme();
  const title = conversation.title.trim() || "New chat";

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onDelete();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${conversationTimeLabel(conversation.updatedAt)}`}
      accessibilityHint="Long press to delete"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.muted : "transparent",
          borderBottomColor: colors.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {conversationTimeLabel(conversation.updatedAt)}
        </Text>
      </View>
      <Symbol name="chevron.right" size={13} color={colors.mutedForeground} fallback="›" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginLeft: 0,
  },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 13 },
});
