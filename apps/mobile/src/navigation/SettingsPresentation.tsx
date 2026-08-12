import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";
import { SettingsScreen } from "../screens/SettingsScreen";
import { ModalSafeArea } from "./ModalSafeArea";

/**
 * Settings, presented instead of tabbed. It lost its tab slot to Ask AI, so it
 * now slides up as a full-screen native modal from Home's title-row gear (and
 * from the live-off empty state). Full-screen rather than a pageSheet on
 * purpose: it's a destination with its own nested sheets (Delete Account), not a
 * quick inline pick like FilterSheet — and the native modal covers the floating
 * tab bar for free, which a same-tree overlay would not.
 *
 * The header carries the only "Settings" title, so SettingsScreen itself renders
 * none (no double title).
 */
export function SettingsPresentation({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* Full-screen means no system chrome inset comes for free — the modal
          owns the status-bar area on both platforms. ModalSafeArea, NOT a
          SafeAreaView: inside a native modal a SafeAreaView measures its own
          (not-yet-laid-out) window and pins this header under the Dynamic
          Island with an untappable Done button — see ModalSafeArea. */}
      <ModalSafeArea backgroundColor={colors.background}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.done, { color: colors.foreground }]}>Done</Text>
          </Pressable>
        </View>
        <SettingsScreen />
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  done: { fontSize: 17, fontWeight: "600" },
});
