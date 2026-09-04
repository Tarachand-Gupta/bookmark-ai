import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import {
  dataUrlPayloadLength,
  fileGlyph,
  fileTypeLabel,
  formatBytes,
} from "../../lib/chatAttachments";
import type { FilePartLike } from "../../lib/chatParts";
import { Symbol } from "../Symbol";

/**
 * A user turn's attachments in the transcript, right-aligned above the text
 * bubble: image thumbnails (tap → full-screen) and document pills. Renders
 * persisted `file` parts too, so a conversation reopened later still shows what
 * was sent.
 */
export function ChatUserAttachments({
  files,
  onOpenImage,
}: {
  files: readonly FilePartLike[];
  onOpenImage: (file: FilePartLike) => void;
}) {
  const { colors, radius } = useAppTheme();
  const images = files.filter((f) => f.mediaType.startsWith("image/"));
  const documents = files.filter((f) => !f.mediaType.startsWith("image/"));
  const thumb = images.length === 1 ? 200 : 116;

  return (
    <View style={styles.wrap}>
      {images.length > 0 && (
        <View style={styles.images}>
          {images.map((file, i) => (
            <Pressable
              key={`${i}-${file.filename ?? ""}`}
              onPress={() => onOpenImage(file)}
              accessibilityRole="imagebutton"
              accessibilityLabel={file.filename ?? "Attached image"}
              accessibilityHint="Opens the image full screen"
              style={({ pressed }) => [
                styles.thumb,
                {
                  width: thumb,
                  height: thumb,
                  borderRadius: radius.xl,
                  borderColor: colors.border,
                  backgroundColor: colors.muted,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Image source={{ uri: file.url }} resizeMode="cover" style={styles.thumbImage} />
            </Pressable>
          ))}
        </View>
      )}
      {documents.map((file, i) => {
        const glyph = fileGlyph(file.mediaType);
        // Decoded size ≈ ¾ of the base64 payload — a label, not a bill.
        const bytes = Math.floor((dataUrlPayloadLength(file.url) * 3) / 4);
        return (
          <View
            key={`${i}-${file.filename ?? ""}`}
            style={[
              styles.doc,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
            ]}
            accessibilityLabel={`${file.filename ?? "Document"}, ${fileTypeLabel(file.mediaType)}`}
          >
            <View style={[styles.docIcon, { backgroundColor: colors.muted, borderRadius: radius.sm }]}>
              <Symbol name={glyph.symbol} size={16} color={colors.mutedForeground} fallback={glyph.fallback} />
            </View>
            <View style={styles.docText}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.docName, { color: colors.foreground }]}>
                {file.filename ?? "Document"}
              </Text>
              <Text numberOfLines={1} style={[styles.docMeta, { color: colors.mutedForeground }]}>
                {fileTypeLabel(file.mediaType, file.filename)}
                {bytes > 0 ? ` · ${formatBytes(bytes)}` : ""}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end", gap: 6, maxWidth: "86%" },
  images: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 },
  thumb: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  thumbImage: { width: "100%", height: "100%" },
  doc: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 280,
  },
  docIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  docText: { flexShrink: 1, gap: 2 },
  docName: { fontSize: 14, fontWeight: "600" },
  docMeta: { fontSize: 12 },
});
