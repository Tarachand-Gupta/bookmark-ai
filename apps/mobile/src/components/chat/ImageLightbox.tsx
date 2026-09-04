import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { FilePartLike } from "../../lib/chatParts";
import { ModalSafeArea } from "../../navigation/ModalSafeArea";
import { Symbol } from "../Symbol";

/**
 * Full-screen view of an attached image (tap a transcript thumbnail). A native
 * modal on black with the filename and a close button; tapping anywhere closes
 * it. `file === null` = closed.
 */
export function ImageLightbox({
  file,
  onClose,
}: {
  file: FilePartLike | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={file !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar style="light" />
      {/* ModalSafeArea, not SafeAreaView — see its note about SafeAreaView inside a Modal. */}
      <ModalSafeArea backgroundColor="#000000">
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
          >
            <Symbol name="xmark" size={18} color="#ffffff" fallback="✕" weight="semibold" />
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>
            {file?.filename ?? "Image"}
          </Text>
          {/* Mirror of the close button so the title stays optically centered. */}
          <View style={styles.close} />
        </View>
        <Pressable style={styles.body} onPress={onClose} accessibilityLabel="Dismiss">
          {file !== null && (
            <Image
              source={{ uri: file.url }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={styles.image}
            />
          )}
        </Pressable>
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: "#ffffff", fontSize: 15, fontWeight: "600" },
  body: { flex: 1, justifyContent: "center" },
  image: { width: "100%", height: "100%" },
});
