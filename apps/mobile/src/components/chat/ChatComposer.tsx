import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../../context/PreferencesContext";
import { Symbol } from "../Symbol";

/** Four lines of 22pt leading + the field's own padding — past that the field
 * scrolls instead of eating the transcript. */
const MAX_INPUT_HEIGHT = 22 * 4 + 20;

/**
 * The pinned composer: a growing multiline field plus one button that is Send
 * while the thread is idle and Stop while a turn streams (never both — there is
 * nothing to send mid-stream, and a second Send would race the same thread).
 *
 * Keyboard avoidance and safe-area padding belong to the screen that hosts this
 * (see ConversationScreen) — the composer is only as tall as its content.
 */
export function ChatComposer({
  streaming,
  onSend,
  onStop,
  placeholder,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  placeholder: string;
}) {
  const { colors, radius } = useAppTheme();
  const [draft, setDraft] = useState("");
  const [height, setHeight] = useState(0);
  const canSend = draft.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    void Haptics.selectionAsync();
    onSend(draft);
    setDraft("");
    setHeight(0);
  };

  return (
    <View style={[styles.row, { borderTopColor: colors.border }]}>
      <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.xl }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          multiline
          // Return inserts a newline (a question can be several lines); sending
          // is the button's job, so there is no submit-on-enter to fight with.
          onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
          style={[
            styles.input,
            {
              color: colors.foreground,
              height: Math.min(Math.max(height, 22) + 20, MAX_INPUT_HEIGHT),
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
          style={styles.button}
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
          style={styles.button}
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: { flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  // letterSpacing: 0 is explicit — iOS leaks the tracked attribute from the
  // sign-in OTP field into later TextInputs (see SearchScreen's note).
  input: { fontSize: 16, lineHeight: 22, paddingTop: 10, paddingBottom: 10, letterSpacing: 0 },
  // 44pt minimum touch target on both axes.
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
