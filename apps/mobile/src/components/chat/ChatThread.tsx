import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { UIMessage } from "ai";
import { useAppTheme } from "../../context/PreferencesContext";
import { useAiChat } from "../../hooks/useAiChat";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import { ChatErrorNotice, ChatLimitNotice, ChatQuotaNotice } from "./ChatNotice";
import { ChatSamplePrompts } from "./ChatSamplePrompts";

/** How far off the bottom the user has to be for auto-scroll to back off. One
 * message-ish — below that, momentum from the stream itself would trip it. */
const STICK_THRESHOLD = 120;

/**
 * The live transcript + composer for ONE conversation. Owns `useChat` (via
 * useAiChat), so it MUST be mounted with a key per conversation: the SDK reads
 * the seeded transcript once, at construction.
 *
 * @param initialMessages stored transcript (empty = new chat)
 * @param initialConversationId null = the server mints one on the first turn
 */
export function ChatThread({
  initialMessages,
  initialConversationId,
  onConversationId,
  onTurnFinished,
  bottomInset,
}: {
  initialMessages: UIMessage[];
  initialConversationId: string | null;
  /** The server-minted id for a brand-new thread (X-Conversation-Id). */
  onConversationId?: (id: string) => void;
  /** A turn finished streaming — the history list is now stale. */
  onTurnFinished?: () => void;
  /** Safe-area bottom inset; the composer sits on top of it. */
  bottomInset: number;
}) {
  const { colors } = useAppTheme();
  const chat = useAiChat({
    initialMessages,
    conversationId: initialConversationId,
    onConversationId,
    onFinish: onTurnFinished,
  });

  const listRef = useRef<FlatList<UIMessage>>(null);
  // Auto-scroll follows the stream ONLY while the user is parked at the bottom.
  // Scrolling up to re-read something must not be yanked back by the next token.
  const stuckToBottom = useRef(true);
  const [showJumpHint, setShowJumpHint] = useState(false);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const atBottom = distanceFromBottom <= STICK_THRESHOLD;
    stuckToBottom.current = atBottom;
    setShowJumpHint(!atBottom);
  }, []);

  const scrollToEnd = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const streaming = chat.status === "streaming" || chat.status === "submitted";

  const send = useCallback(
    (text: string) => {
      // A send always re-anchors: you asked something, you want to see the answer.
      stuckToBottom.current = true;
      setShowJumpHint(false);
      chat.send(text);
    },
    [chat],
  );

  const footer = (
    <View style={styles.footer}>
      {chat.status === "submitted" && (
        <View style={styles.thinking}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.thinkingText, { color: colors.mutedForeground }]}>Thinking…</Text>
        </View>
      )}
      {chat.limit !== null && <ChatLimitNotice info={chat.limit} />}
      {chat.quota !== null && <ChatQuotaNotice message={chat.quota} />}
      {/* A paywall already explained itself — don't stack a generic error on it. */}
      {chat.error !== undefined && chat.limit === null && chat.quota === null && (
        <ChatErrorNotice onRetry={chat.retry} />
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      // Android resizes the window itself (windowSoftInputMode=adjustResize), so
      // a behavior there double-counts the keyboard — same split as SignInScreen.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <FlatList
        ref={listRef}
        data={chat.messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatMessage message={item} />}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListHeaderComponent={<View style={styles.gap} />}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ChatSamplePrompts onPick={send} />
          </View>
        }
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Growing content (a token landed, a tool chip appeared) follows the
        // bottom; `false` while the user is reading further up.
        onContentSizeChange={() => {
          if (stuckToBottom.current) scrollToEnd(false);
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      />
      {showJumpHint && chat.messages.length > 0 && (
        <JumpToLatest onPress={() => scrollToEnd(true)} />
      )}
      <View style={{ paddingBottom: bottomInset }}>
        <ChatComposer
          streaming={streaming}
          onSend={send}
          onStop={chat.stop}
          placeholder={
            chat.messages.length === 0 ? "Ask anything about your bookmarks…" : "Ask a follow-up…"
          }
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/** Shown once the user has scrolled away from a streaming answer. */
function JumpToLatest({ onPress }: { onPress: () => void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.jumpWrap} pointerEvents="box-none">
      <Text
        onPress={onPress}
        accessibilityRole="button"
        style={[
          styles.jump,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radius.xl,
            color: colors.foreground,
          },
        ]}
      >
        Jump to latest
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 12 },
  gap: { height: 14 },
  footer: { gap: 12, paddingTop: 12 },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  thinkingText: { fontSize: 14 },
  empty: { flex: 1, justifyContent: "flex-end", paddingBottom: 12 },
  jumpWrap: { alignItems: "center", paddingBottom: 8 },
  jump: {
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: "600",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
