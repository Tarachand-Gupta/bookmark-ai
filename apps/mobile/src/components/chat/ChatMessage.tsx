import { StyleSheet, Text, View } from "react-native";
import type { UIMessage } from "ai";
import { useAppTheme } from "../../context/PreferencesContext";
import {
  assistantBlocks,
  userContent,
  type FilePartLike,
  type LoosePart,
} from "../../lib/chatParts";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatReasoning } from "./ChatReasoning";
import { ChatToolRow } from "./ChatToolRow";
import { ChatUserAttachments } from "./ChatUserAttachments";

/**
 * One turn in the thread. User messages are right-aligned bubbles (the phone
 * convention) with their attachments stacked above the text; the assistant
 * answers left-aligned on the background with no bubble — its replies are long,
 * markdown-formatted, and often contain tables and code, none of which survives
 * being boxed at 80% width.
 *
 * Assistant parts render IN ORDER (see assistantBlocks): a thought, then the
 * tool row exactly where the agent ran it, then prose — which is what makes a
 * multi-step answer legible. Unknown part types render nothing, never a crash.
 */
export function ChatMessage({
  message,
  onOpenImage,
}: {
  message: UIMessage;
  /** A transcript thumbnail was tapped — the thread owns the lightbox. */
  onOpenImage: (file: FilePartLike) => void;
}) {
  const { colors, radius } = useAppTheme();
  const parts = message.parts as unknown as LoosePart[];

  if (message.role === "user") {
    const { text, files } = userContent(parts);
    if (!text && files.length === 0) return null;
    return (
      <View style={styles.userRow}>
        {files.length > 0 && <ChatUserAttachments files={files} onOpenImage={onOpenImage} />}
        {text.length > 0 && (
          <View
            style={[styles.userBubble, { backgroundColor: colors.primary, borderRadius: radius.xl }]}
          >
            <Text style={[styles.userText, { color: colors.primaryForeground }]}>{text}</Text>
          </View>
        )}
      </View>
    );
  }

  const blocks = assistantBlocks(message.id, parts);
  if (blocks.length === 0) return null;
  return (
    <View style={styles.assistantRow}>
      {blocks.map((block) => {
        switch (block.kind) {
          case "text":
            return <ChatMarkdown key={block.key} text={block.text} />;
          case "reasoning":
            return (
              <ChatReasoning
                key={block.key}
                id={block.key}
                text={block.text}
                streaming={block.streaming}
              />
            );
          case "tool":
            return <ChatToolRow key={block.key} part={block.part} />;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end", gap: 6, paddingHorizontal: 16 },
  userBubble: { maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 22 },
  assistantRow: { gap: 10, paddingHorizontal: 16 },
});
