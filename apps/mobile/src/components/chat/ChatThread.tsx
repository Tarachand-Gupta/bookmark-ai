import { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
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
import { useChatAttachments } from "../../hooks/useChatAttachments";
import { useContentWidth } from "../../hooks/useContentWidth";
import { useKeyboardOverlap } from "../../hooks/useKeyboardOverlap";
import { toFileParts } from "../../lib/chatAttachments";
import {
  assistantBlocks,
  userContent,
  type FilePartLike,
  type LoosePart,
} from "../../lib/chatParts";
import { ChatComposer } from "./ChatComposer";
import { ChatEmptyState } from "./ChatEmptyState";
import { ChatMessage } from "./ChatMessage";
import {
  ChatErrorNotice,
  ChatLimitNotice,
  ChatQuotaNotice,
  ChatRejectedNotice,
} from "./ChatNotice";
import { ChatSourceNote } from "./ChatSourceNote";
import { ChatThinking } from "./ChatThinking";
import { ImageLightbox } from "./ImageLightbox";

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
  /** Safe-area bottom inset; the composer sits on top of it while the keyboard is
   * down — once it's up the keyboard's own frame (which already spans that inset)
   * takes over. */
  bottomInset: number;
}) {
  const { colors } = useAppTheme();
  const keyboardOverlap = useKeyboardOverlap();
  // Tablet widths: transcript, empty state and (below) the composer share the
  // centered content column, so a reply never runs 1000pt wide. 0 on phones.
  const { inset } = useContentWidth();
  const chat = useAiChat({
    initialMessages,
    conversationId: initialConversationId,
    onConversationId,
    onFinish: onTurnFinished,
  });
  const attachments = useChatAttachments();
  const [lightbox, setLightbox] = useState<FilePartLike | null>(null);

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

  const contentHeight = useRef(0);
  const layoutHeight = useRef(0);

  // NOT FlatList.scrollToEnd: that targets the list's own bookkeeping of the
  // content length, which lags a frame behind a burst of growth (a thought
  // landing as one chunk while the "Thinking" footer swaps out for the first
  // row). It scrolled to the OLD end, the resulting scroll event read as "the
  // user scrolled up", and the follow stopped mid-stream. The measured content
  // height is exact; the native side clamps any overshoot.
  const scrollToEnd = useCallback((animated: boolean) => {
    const list = listRef.current;
    if (!list) return;
    if (layoutHeight.current > 0 && contentHeight.current > 0) {
      const offset = Math.max(0, contentHeight.current - layoutHeight.current);
      list.scrollToOffset({ offset, animated });
    } else {
      list.scrollToEnd({ animated });
    }
  }, []);

  // When everything fits in the viewport there is nothing to jump to. Checked on
  // both content and layout changes because neither fires a scroll event: the
  // keyboard going away (layout grows) or a lightbox closing used to leave a
  // stale "Jump to latest" from the last scroll while the list was shorter.
  const settleIfFits = useCallback(() => {
    if (contentHeight.current <= layoutHeight.current + STICK_THRESHOLD) {
      stuckToBottom.current = true;
      setShowJumpHint(false);
    }
  }, []);

  const streaming = chat.status === "streaming" || chat.status === "submitted";

  // The instant placeholder: from the send until the first thing worth drawing
  // (a thought, a tool row, a token) exists on the assistant turn. `submitted`
  // has no assistant message yet; early `streaming` may hold only a step-start.
  const last = chat.messages[chat.messages.length - 1];
  const awaitingFirstToken =
    chat.status === "submitted" ||
    (chat.status === "streaming" && (last === undefined || !hasContent(last)));

  // Only turns that draw something are list items: a failed turn leaves an
  // assistant message with no parts behind (the server persists it too), and as
  // a row it would still collect the separators around it — a blank stripe in
  // the transcript.
  const rows = useMemo(() => chat.messages.filter(hasContent), [chat.messages]);

  const send = useCallback(
    (text: string) => {
      // A send always re-anchors: you asked something, you want to see the answer.
      stuckToBottom.current = true;
      setShowJumpHint(false);
      chat.send(text, toFileParts(attachments.items));
      attachments.clear();
    },
    [chat, attachments],
  );

  const footer = (
    <View style={styles.footer}>
      {awaitingFirstToken && <ChatThinking />}
      {/* Which key answered the reply above, when it's worth a word: it ran on
          the user's own key because the free credits are spent, or on the
          included AI because the saved key still has no model. */}
      {!awaitingFirstToken && chat.aiSource === "own-fallback" && (
        <ChatSourceNote kind="own-fallback" />
      )}
      {!awaitingFirstToken && chat.aiNote === "own-key-incomplete" && (
        <ChatSourceNote kind="own-key-incomplete" />
      )}
      {chat.rejected !== null && <ChatRejectedNotice message={chat.rejected} />}
      {chat.limit !== null && <ChatLimitNotice info={chat.limit} />}
      {chat.quota !== null && <ChatQuotaNotice message={chat.quota} />}
      {/* A paywall or rejection already explained itself — don't stack a generic error on it. */}
      {chat.error !== undefined &&
        chat.limit === null &&
        chat.quota === null &&
        chat.rejected === null && <ChatErrorNotice onRetry={chat.retry} />}
    </View>
  );

  return (
    // Keyboard avoidance by hand, NOT KeyboardAvoidingView: this thread lives
    // inside a full-screen native Modal, below ModalSafeArea's paddingTop and a
    // header, and KeyboardAvoidingView measures its own frame relative to its
    // PARENT while comparing it to a window-space keyboard edge — so it padded by
    // (keyboard height − insets.top), i.e. insets.top too little, and the composer
    // hung that far under the keyboard (measured on iPhone 17 / iOS 26.5 with the
    // QuickType bar up: keyboard 335, top inset 62 → padding 273, leaving 28pt of
    // the 62pt composer row clipped; worse on the 14 Pro Max that reported it).
    // No `keyboardVerticalOffset` constant tracks that across devices.
    //
    // iOS: `max`, not `+` — the keyboard frame is measured from the window
    // bottom and already spans the home-indicator area, so adding the inset
    // would leave a gap. Android: `+` — ReactRootView reports the IME height
    // MINUS the system-bar inset (`imeInsets.bottom - barInsets.bottom`), and
    // this modal window runs edge-to-edge under that bar, so the two stack.
    // With the keyboard down the inset is all that's needed on both. This View
    // reaches the window bottom (ModalSafeArea deliberately applies no bottom
    // padding), which is the frame useKeyboardOverlap's number is measured against.
    <View
      style={[
        styles.flex,
        {
          paddingBottom:
            Platform.OS === "android"
              ? keyboardOverlap + bottomInset
              : Math.max(keyboardOverlap, bottomInset),
        },
      ]}
    >
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatMessage message={item} onOpenImage={setLightbox} />}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListHeaderComponent={<View style={styles.gap} />}
        ListFooterComponent={footer}
        ListEmptyComponent={
          // Centered in the free area (the list fills it: `content` grows). On
          // a screen too short for the block — a phone with the keyboard up —
          // the content is taller than the list and the stick-to-bottom scroll
          // below parks the prompts right above the composer instead.
          <View style={styles.empty}>
            <ChatEmptyState onPick={send} />
          </View>
        }
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={(e) => {
          layoutHeight.current = e.nativeEvent.layout.height;
          settleIfFits();
          // The viewport shrank (keyboard up) while parked at the bottom: keep
          // the latest content — or the empty state's prompts — above the
          // composer rather than letting the keyboard cover it.
          if (stuckToBottom.current && contentHeight.current > layoutHeight.current) {
            scrollToEnd(false);
          }
        }}
        // Growing content (a token landed, a tool row appeared) follows the
        // bottom; `false` while the user is reading further up.
        onContentSizeChange={(_, height) => {
          contentHeight.current = height;
          if (stuckToBottom.current) scrollToEnd(false);
          settleIfFits();
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingHorizontal: inset }]}
      />
      {showJumpHint && rows.length > 0 && (
        <JumpToLatest onPress={() => scrollToEnd(true)} />
      )}
      <ChatComposer
        streaming={streaming}
        onSend={send}
        onStop={chat.stop}
        attachments={attachments}
        // Short enough to sit on one line beside the paperclip and Send.
        placeholder={chat.messages.length === 0 ? "Ask about your bookmarks…" : "Ask a follow-up…"}
      />
      <ImageLightbox file={lightbox} onClose={() => setLightbox(null)} />
    </View>
  );
}

/** Whether a message renders anything (ChatMessage returns null otherwise). */
function hasContent(message: UIMessage): boolean {
  const parts = message.parts as unknown as LoosePart[];
  if (message.role === "user") {
    const { text, files } = userContent(parts);
    return text.length > 0 || files.length > 0;
  }
  return assistantBlocks(message.id, parts).length > 0;
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
  // `flex: 1` fills the grown content box, `center` composes the block in it.
  empty: { flex: 1, justifyContent: "center", paddingVertical: 24 },
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
