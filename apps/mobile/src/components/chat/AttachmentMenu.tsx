import { useCallback, useState, type ReactNode } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SymbolViewProps } from "expo-symbols";
import { useAppTheme } from "../../context/PreferencesContext";
import { Symbol } from "../Symbol";

/** The fade-out of the Android sheet (Modal animationType="fade") plus a beat. */
const SHEET_DISMISS_MS = 220;

/**
 * The paperclip's "Photo Library / Files" choice. iOS gets the native action
 * sheet (the thing a phone user expects from a paperclip); Android gets an
 * equivalent bottom sheet drawn here, since it has no system counterpart.
 *
 * Returns `open()` for the button and `element` to mount once in the composer
 * (null on iOS).
 */
export function useAttachmentMenu({
  onPhotos,
  onFiles,
}: {
  onPhotos: () => void;
  onFiles: () => void;
}): { open: () => void; element: ReactNode } {
  const { dark } = useAppTheme();
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => {
    void Haptics.selectionAsync();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Photo Library", "Files", "Cancel"],
          cancelButtonIndex: 2,
          userInterfaceStyle: dark ? "dark" : "light",
        },
        (index) => {
          if (index === 0) onPhotos();
          else if (index === 1) onFiles();
        },
      );
      return;
    }
    setVisible(true);
  }, [dark, onPhotos, onFiles]);

  // The sheet is a native Dialog window; the picker is another Activity. Let
  // the sheet actually go away before starting the picker so the Activity is
  // launched from a plain, resumed MainActivity rather than from under a
  // dismissing dialog.
  const afterSheet = (action: () => void) => {
    setVisible(false);
    setTimeout(action, SHEET_DISMISS_MS);
  };

  const element =
    Platform.OS === "ios" ? null : (
      <AttachmentSheet
        visible={visible}
        onClose={() => setVisible(false)}
        onPhotos={() => afterSheet(onPhotos)}
        onFiles={() => afterSheet(onFiles)}
      />
    );

  return { open, element };
}

function AttachmentSheet({
  visible,
  onClose,
  onPhotos,
  onFiles,
}: {
  visible: boolean;
  onClose: () => void;
  onPhotos: () => void;
  onFiles: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radius.xl,
              marginBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <Text style={[styles.title, { color: colors.mutedForeground }]}>ATTACH</Text>
          <SheetRow symbol="photo.on.rectangle" fallback="▣" label="Photo library" onPress={onPhotos} />
          <SheetRow symbol="folder" fallback="▭" label="Files" onPress={onFiles} last />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: colors.muted, borderRadius: radius.lg, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: colors.foreground }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SheetRow({
  symbol,
  fallback,
  label,
  onPress,
  last,
}: {
  symbol: SymbolViewProps["name"];
  fallback: string;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.muted },
      ]}
    >
      <Symbol name={symbol} size={20} color={colors.foreground} fallback={fallback} />
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    marginHorizontal: 12,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 0,
  },
  title: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, marginLeft: 8, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 14 },
  rowLabel: { fontSize: 17 },
  cancel: { alignItems: "center", justifyContent: "center", paddingVertical: 13, marginTop: 10 },
  cancelLabel: { fontSize: 17, fontWeight: "600" },
});
