import { Modal } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";
import { ConversationScreen, type ConversationTarget } from "../screens/ConversationScreen";
import { ModalSafeArea } from "./ModalSafeArea";

/**
 * A chat thread, presented instead of tabbed — the same full-screen native modal
 * pattern as SettingsPresentation, and for the same reason: the native modal
 * covers the floating tab bar for free (WhatsApp-style: no tabs while you're in a
 * conversation), which a same-tree overlay would not.
 *
 * `target === null` = closed. The target is passed rather than kept here so the
 * Ask AI tab stays the single owner of "which conversation is open", and so the
 * whole thread unmounts on close (a closed modal must not keep a live stream).
 *
 * `overFullScreen` for the same reason as SettingsPresentation (see the note
 * there): a `fullScreen` presentation detaches the app's root view, which is
 * the only thing that tells React Native about an OS light/dark switch — the
 * thread would stay in the old theme until closed.
 */
export function ConversationPresentation({
  target,
  onClose,
}: {
  target: ConversationTarget | null;
  onClose: (changed: boolean) => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Modal
      visible={target !== null}
      animationType="slide"
      presentationStyle="overFullScreen"
      // Android's hardware/gesture back closes the thread (no unsaved state to
      // lose — every turn is persisted server-side as it streams).
      onRequestClose={() => onClose(false)}
    >
      {/* Full-screen means no system chrome inset comes for free — the modal owns
          the status-bar area. `bottom` is deliberately NOT included: the composer
          applies that inset itself so the keyboard can slide over it. ModalSafeArea,
          NOT a SafeAreaView: inside a native modal a SafeAreaView measures its own
          (not-yet-laid-out) window and pins this thread's header under the Dynamic
          Island with an untappable Back button — see ModalSafeArea. */}
      <ModalSafeArea backgroundColor={colors.background}>
        {target !== null && <ConversationScreen target={target} onClose={onClose} />}
      </ModalSafeArea>
    </Modal>
  );
}
