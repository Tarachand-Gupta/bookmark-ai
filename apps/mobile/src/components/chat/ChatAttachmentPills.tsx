import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../../context/PreferencesContext";
import {
  fileGlyph,
  fileTypeLabel,
  formatBytes,
  type PendingAttachment,
} from "../../lib/chatAttachments";
import { Symbol } from "../Symbol";

const PILL_HEIGHT = 56;

/**
 * The files staged in the composer, as a horizontal rail above the field:
 * image thumbnails, or icon + filename + size for documents, each with a
 * remove ×. Sits inside the composer so the keyboard avoidance the thread
 * already does covers it.
 */
export function ChatAttachmentPills({
  items,
  onRemove,
  disabled,
}: {
  items: readonly PendingAttachment[];
  onRemove: (id: string) => void;
  /** While a turn streams the staged files are frozen (they belong to the next send). */
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  const remove = (id: string) => {
    void Haptics.selectionAsync();
    onRemove(id);
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.rail}
      contentContainerStyle={styles.railContent}
      accessibilityLabel={`${items.length} ${items.length === 1 ? "attachment" : "attachments"}`}
    >
      {items.map((item) =>
        item.kind === "image" ? (
          <ImagePill key={item.id} item={item} onRemove={remove} disabled={disabled} />
        ) : (
          <DocumentPill key={item.id} item={item} onRemove={remove} disabled={disabled} />
        ),
      )}
    </ScrollView>
  );
}

function RemoveButton({
  filename,
  onPress,
  disabled,
}: {
  filename: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${filename}`}
      style={({ pressed }) => [
        styles.remove,
        { backgroundColor: colors.foreground, borderColor: colors.background },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Symbol name="xmark" size={9} color={colors.background} fallback="×" weight="bold" />
    </Pressable>
  );
}

function ImagePill({
  item,
  onRemove,
  disabled,
}: {
  item: PendingAttachment;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.imageWrap}>
      <Image
        source={{ uri: item.url }}
        resizeMode="cover"
        accessibilityLabel={item.filename}
        style={[styles.image, { borderRadius: radius.md, borderColor: colors.border }]}
      />
      <RemoveButton filename={item.filename} onPress={() => onRemove(item.id)} disabled={disabled} />
    </View>
  );
}

function DocumentPill({
  item,
  onRemove,
  disabled,
}: {
  item: PendingAttachment;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const glyph = fileGlyph(item.mediaType);
  return (
    <View
      style={[
        styles.doc,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <View style={[styles.docIcon, { backgroundColor: colors.muted, borderRadius: radius.sm }]}>
        <Symbol name={glyph.symbol} size={16} color={colors.mutedForeground} fallback={glyph.fallback} />
      </View>
      <View style={styles.docText}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.docName, { color: colors.foreground }]}>
          {item.filename}
        </Text>
        <Text numberOfLines={1} style={[styles.docMeta, { color: colors.mutedForeground }]}>
          {fileTypeLabel(item.mediaType, item.filename)} · {formatBytes(item.bytes)}
        </Text>
      </View>
      <Pressable
        onPress={() => onRemove(item.id)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.filename}`}
        style={({ pressed }) => [styles.docRemove, (pressed || disabled) && { opacity: 0.5 }]}
      >
        <Symbol name="xmark.circle.fill" size={18} color={colors.mutedForeground} fallback="⊗" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { marginHorizontal: -16 },
  railContent: { gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  imageWrap: { width: PILL_HEIGHT, height: PILL_HEIGHT, marginTop: 6, marginRight: 6 },
  image: { width: PILL_HEIGHT, height: PILL_HEIGHT, borderWidth: StyleSheet.hairlineWidth },
  remove: {
    position: "absolute",
    top: -7,
    right: -7,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  doc: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: PILL_HEIGHT,
    marginTop: 6,
    paddingLeft: 10,
    paddingRight: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 260,
  },
  docIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  docText: { flexShrink: 1, gap: 2, minWidth: 90 },
  docName: { fontSize: 13, fontWeight: "600" },
  docMeta: { fontSize: 11 },
  docRemove: { width: 28, height: 44, alignItems: "center", justifyContent: "center" },
});
