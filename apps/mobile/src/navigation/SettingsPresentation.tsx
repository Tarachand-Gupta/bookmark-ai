import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";
import { useContentWidth } from "../hooks/useContentWidth";
import { SettingsScreen, SETTINGS_TITLES, type SettingsPage } from "../screens/SettingsScreen";
import { Symbol } from "../components/Symbol";
import { ModalSafeArea } from "./ModalSafeArea";

/**
 * Settings, presented instead of tabbed. It lost its tab slot to Ask AI, so it
 * now slides up as a full-screen native modal from Home's title-row gear (and
 * from the live-off empty state). Full-screen rather than a pageSheet on
 * purpose: it's a destination with its own nested sheets (Delete Account), not a
 * quick inline pick like FilterSheet — and the native modal covers the floating
 * tab bar for free, which a same-tree overlay would not.
 *
 * `overFullScreen`, NOT `fullScreen`, and this is load-bearing: with
 * `fullScreen` UIKit removes the presenting view controller's view from the
 * window once the slide-in finishes, and on iOS React Native learns of an OS
 * light/dark switch ONLY through that root surface view's
 * `traitCollectionDidChange` (RCTSurfaceHostingView posts
 * RCTUserInterfaceStyleDidChangeNotification; no Modal host view controller
 * does). Detached, it hears nothing — so with Appearance = System the app behind
 * the modal went dark while this modal stayed light until it was closed and
 * reopened. `overFullScreen` keeps the presenting view in the hierarchy (our
 * content is opaque, so nothing shows through) and the theme follows live.
 *
 * The header carries the only "Settings" title, so SettingsScreen itself renders
 * none (no double title). On tablet widths it shares the content column's inset
 * so the title and Done sit over the column's edges, not the screen's.
 */
export function SettingsPresentation({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { inset } = useContentWidth();
  const [page, setPage] = useState<SettingsPage>("root");
  const close = () => { setPage("root"); onClose(); };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={page === "root" ? close : () => setPage("root")}
    >
      {/* Full-screen means no system chrome inset comes for free — the modal
          owns the status-bar area on both platforms. ModalSafeArea, NOT a
          SafeAreaView: inside a native modal a SafeAreaView measures its own
          (not-yet-laid-out) window and pins this header under the Dynamic
          Island with an untappable Done button — see ModalSafeArea. */}
      <ModalSafeArea backgroundColor={colors.background}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingHorizontal: HEADER_GUTTER + inset },
          ]}
        >
          {page !== "root" && <Pressable onPress={() => setPage("root")} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to Settings"><Symbol name="chevron.left" color={colors.foreground} size={21} /></Pressable>}
          <Text style={[styles.headerTitle, { color: colors.foreground, marginLeft: page === "root" ? 0 : 12 }]}>{SETTINGS_TITLES[page]}</Text>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.done, { color: colors.foreground }]}>Done</Text>
          </Pressable>
        </View>
        <SettingsScreen page={page} onNavigate={setPage} />
      </ModalSafeArea>
    </Modal>
  );
}

/** Same 20pt gutter SettingsScreen's list content uses, so title and groups align. */
const HEADER_GUTTER = 20;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: HEADER_GUTTER,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600", marginHorizontal: 12 },
  done: { fontSize: 17, fontWeight: "600" },
});
