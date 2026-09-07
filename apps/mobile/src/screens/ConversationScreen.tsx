import { useCallback, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatThread } from "../components/chat/ChatThread";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useContentWidth } from "../hooks/useContentWidth";
import { useConversation } from "../hooks/useConversation";

/** What the Ask AI tab asked to open: a fresh thread, or a stored one. */
export type ConversationTarget = { kind: "new" } | { kind: "existing"; id: string; title: string };

/**
 * One conversation, full-screen (WhatsApp's model: the tab bar is gone while
 * you're in a thread — the native modal that hosts this covers it, see
 * ConversationPresentation).
 *
 * A stored thread is fetched first and the transcript SEEDS the chat, so
 * ChatThread only mounts once its messages exist — `useChat` reads its initial
 * messages at construction, and a keyed remount mid-thread would drop a stream.
 */
export function ConversationScreen({
  target,
  onClose,
}: {
  target: ConversationTarget;
  /** `changed` = something the history list should re-read (a new conversation
   * was created, or a turn finished and bumped `updatedAt`). */
  onClose: (changed: boolean) => void;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Tablet widths: the Back button sits over the content column's edge, in line
  // with the composer's paperclip below it (the title stays screen-centered).
  const { inset } = useContentWidth();
  const existingId = target.kind === "existing" ? target.id : null;
  const detail = useConversation(existingId);
  // Whether anything happened worth refreshing the list for. A ref, not state:
  // it must not re-render the thread mid-stream.
  const changed = useRef(false);

  const onConversationId = useCallback(() => {
    changed.current = true;
  }, []);
  const onTurnFinished = useCallback(() => {
    changed.current = true;
  }, []);

  // A stored thread shows its known title instantly (the row we came from had
  // it); the fetched record then wins in case it was renamed elsewhere.
  const title =
    detail.conversation?.title.trim() ||
    (target.kind === "existing" ? target.title.trim() : "") ||
    "New chat";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border, paddingHorizontal: HEADER_GUTTER + inset },
        ]}
      >
        <Pressable
          onPress={() => onClose(changed.current)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Symbol name="chevron.left" size={20} color={colors.foreground} fallback="‹" />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {/* Mirror of the back button's width so the title stays optically centered. */}
        <View style={styles.back} />
      </View>

      {detail.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : detail.error !== null ? (
        <View style={styles.center}>
          <Symbol
            name="exclamationmark.triangle"
            size={26}
            color={colors.mutedForeground}
            fallback="!"
          />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            Couldn&apos;t load this chat
          </Text>
          <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>{detail.error}</Text>
          <Pressable
            onPress={detail.retry}
            accessibilityRole="button"
            style={[styles.retry, { borderColor: colors.border }]}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : (
        <ChatThread
          initialMessages={detail.messages}
          initialConversationId={existingId}
          onConversationId={onConversationId}
          onTurnFinished={onTurnFinished}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

/** The header's own gutter; the content column's inset is added on tablets. */
const HEADER_GUTTER = 12;

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: HEADER_GUTTER,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 44, height: 32, alignItems: "flex-start", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 32 },
  errorTitle: { fontSize: 17, fontWeight: "600" },
  errorBody: { fontSize: 15, textAlign: "center", lineHeight: 20 },
  retry: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
});
