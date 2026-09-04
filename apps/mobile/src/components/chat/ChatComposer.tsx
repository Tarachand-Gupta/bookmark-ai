import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../../context/PreferencesContext";
import type { ChatAttachmentsState } from "../../hooks/useChatAttachments";
import { canSendTurn } from "../../lib/chatAttachments";
import { Symbol } from "../Symbol";
import { useAttachmentMenu } from "./AttachmentMenu";
import { ChatAttachmentPills } from "./ChatAttachmentPills";

const LINE_HEIGHT = 22;
/** Four lines — past that the field scrolls instead of eating the transcript. */
const MAX_INPUT_HEIGHT = LINE_HEIGHT * 4;

/**
 * The pinned composer: a paperclip (photo library / files), a growing multiline
 * field, and one button that is Send while the thread is idle and Stop while a
 * turn streams (never both — there is nothing to send mid-stream, and a second
 * Send would race the same thread). Staged attachments ride above the field as
 * pills; a rejection reads out beneath them and clears itself.
 *
 * Attachments alone are a message (the web allows it too — the server titles
 * the conversation from the filename): Send is live as soon as a pill exists,
 * and an empty text part is simply omitted.
 *
 * Keyboard avoidance and safe-area padding belong to the thread that hosts this
 * (see ChatThread) — the composer is only as tall as its content.
 */
export function ChatComposer({
  streaming,
  onSend,
  onStop,
  placeholder,
  attachments,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  placeholder: string;
  attachments: ChatAttachmentsState;
}) {
  const { colors, radius } = useAppTheme();
  const [draft, setDraft] = useState("");
  const [height, setHeight] = useState(0);
  const menu = useAttachmentMenu({ onPhotos: attachments.pickPhotos, onFiles: attachments.pickFiles });
  const hasFiles = attachments.items.length > 0;
  // Same rule the send path applies, so the button can never be live for a turn
  // that would be dropped (or dead for one that would go).
  const canSend = canSendTurn(draft, attachments.items.length);
  const clipDisabled = streaming || attachments.busy;

  const submit = () => {
    if (!canSend) return;
    void Haptics.selectionAsync();
    onSend(draft);
    setDraft("");
    setHeight(0);
  };

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      <ChatAttachmentPills items={attachments.items} onRemove={attachments.remove} disabled={streaming} />
      {attachments.error !== null && (
        <Pressable
          onPress={attachments.dismissError}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.errorRow}
        >
          <Symbol name="exclamationmark.circle" size={14} color={colors.destructive} fallback="!" />
          <Text style={[styles.errorText, { color: colors.destructive }]}>{attachments.error}</Text>
        </Pressable>
      )}
      <View style={styles.row}>
        <Pressable
          onPress={menu.open}
          disabled={clipDisabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Attach a photo or file"
          accessibilityState={{ disabled: clipDisabled, busy: attachments.busy }}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
        >
          <View
            style={[
              styles.clip,
              { backgroundColor: colors.muted, opacity: streaming ? 0.45 : 1 },
            ]}
          >
            {attachments.busy ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Symbol name="paperclip" size={18} color={colors.foreground} fallback="⊕" />
            )}
          </View>
        </Pressable>
        <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.xl }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={hasFiles ? "Ask about the attachment…" : placeholder}
            placeholderTextColor={colors.mutedForeground}
            multiline
            // Return inserts a newline (a question can be several lines); sending
            // is the button's job, so there is no submit-on-enter to fight with.
            onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
            // The vertical padding lives on the wrapper, NOT the input: iOS
            // reports contentSize WITH the input's own padding on the first
            // layout and WITHOUT it after an edit, so a padded input measured
            // itself two lines tall on a fresh thread and one line after the
            // first send. Bare text is unambiguous.
            style={[
              styles.input,
              {
                color: colors.foreground,
                height: Math.min(Math.max(height, LINE_HEIGHT), MAX_INPUT_HEIGHT),
              },
            ]}
            accessibilityLabel="Message"
          />
        </View>
        {streaming ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onStop();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Stop generating"
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
          >
            <Symbol name="stop.circle.fill" size={30} color={colors.foreground} fallback="■" />
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canSend}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => [styles.button, pressed && canSend && { opacity: 0.5 }]}
          >
            <Symbol
              name="arrow.up.circle.fill"
              size={32}
              color={canSend ? colors.foreground : colors.mutedForeground}
              fallback="↑"
            />
          </Pressable>
        )}
      </View>
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 6 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 6, paddingHorizontal: 2 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  field: { flex: 1, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10 },
  // letterSpacing: 0 is explicit — iOS leaks the tracked attribute from the
  // sign-in OTP field into later TextInputs (see SearchScreen's note). Zero
  // padding on both axes: Android's EditText brings its own otherwise.
  input: {
    fontSize: 16,
    lineHeight: LINE_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 0,
    letterSpacing: 0,
    textAlignVertical: "top",
  },
  // 44pt minimum touch target on both axes.
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  clip: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
