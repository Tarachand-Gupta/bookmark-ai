import { StyleSheet, Text, View } from "react-native";
import type { UIMessage } from "ai";
import { useAppTheme } from "../../context/PreferencesContext";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatToolChip } from "./ChatToolChip";

/**
 * The fields this renderer reads off a UIMessage part. The AI SDK's part union is
 * huge and version-coupled (text, reasoning, sources, files, per-tool variants,
 * data parts); everything here is optional so an unrecognized part is skipped
 * rather than crashing a thread — including parts written by a NEWER server than
 * this build knows about.
 */
interface LoosePart {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
}

/**
 * One turn in the thread. User messages are right-aligned bubbles (the phone
 * convention); the assistant answers left-aligned on the background with no
 * bubble — its replies are long, markdown-formatted, and often contain tables and
 * code, none of which survives being boxed at 80% width.
 *
 * Parts render IN ORDER, so a tool chip appears exactly where the agent ran it
 * (search → prose → another search → prose), which is what makes a multi-step
 * answer legible.
 */
export function ChatMessage({ message }: { message: UIMessage }) {
  const { colors, radius } = useAppTheme();
  const parts = message.parts as unknown as LoosePart[];

  if (message.role === "user") {
    // Every text part joined: a user turn is one thing the person typed, even
    // when the SDK split it.
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return null;
    return (
      <View style={styles.userRow}>
        <View
          style={[styles.userBubble, { backgroundColor: colors.primary, borderRadius: radius.xl }]}
        >
          <Text style={[styles.userText, { color: colors.primaryForeground }]}>{text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      {parts.map((part, i) => {
        if (part.type === "text") {
          const text = part.text ?? "";
          if (!text.trim()) return null;
          return <ChatMarkdown key={`${message.id}-${i}`} text={text} />;
        }
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
          return (
            <ChatToolChip
              key={part.toolCallId ?? `${message.id}-${i}`}
              partType={part.type}
              state={part.state ?? "input-available"}
            />
          );
        }
        // reasoning / step-start / sources / data-* — nothing to show on a phone.
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end", paddingHorizontal: 16 },
  userBubble: { maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 22 },
  assistantRow: { gap: 8, paddingHorizontal: 16 },
});
