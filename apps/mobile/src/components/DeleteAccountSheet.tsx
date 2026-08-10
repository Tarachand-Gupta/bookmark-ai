import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { deleteAccount } from "../api";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";

/** The literal the user has to type to arm the button (email also accepted). */
const CONFIRM_WORD = "DELETE";

/**
 * Does what the user typed authorize the deletion? Either the exact word
 * `DELETE` (case-sensitive on purpose — it must be deliberate) or their own
 * account email (case-insensitive, since keyboards autocapitalize).
 */
export function confirmationMatches(typed: string, email: string): boolean {
  const trimmed = typed.trim();
  if (trimmed === CONFIRM_WORD) return true;
  return email.length > 0 && trimmed.toLowerCase() === email.toLowerCase();
}

/**
 * Account deletion — the App Store hard requirement (Guideline 5.1.1(v): an app
 * with account creation must offer in-app account deletion, not just a support
 * link). Deliberately more friction than Sign Out: a destructive Settings row
 * opens this sheet, the user must type DELETE (or their email), and only then is
 * the button armed. `DELETE /api/account` removes the Clerk user; its
 * `user.deleted` webhook tears down the tenant DB.
 *
 * Failures are reported verbatim and the sheet STAYS OPEN with the session
 * intact — never sign out on a failed delete, that would strand a still-live
 * account behind a "deleted" story. Only a 202 leads to `onDeleted()`.
 */
export function DeleteAccountSheet({
  visible,
  email,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  /** The signed-in user's primary email — accepted as the confirmation phrase. */
  email: string;
  onClose: () => void;
  /** Called after the server confirms deletion (202); the caller signs out. */
  onDeleted: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh, unarmed form every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setTyped("");
      setError(null);
      setDeleting(false);
    }
  }, [visible]);

  const armed = confirmationMatches(typed, email) && !deleting;

  const run = async () => {
    if (!armed) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDeleted();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={deleting ? undefined : onClose}
    >
      {/* pageSheet is iOS-only; on Android the modal is fullscreen, so pad
          the header below the status bar (same as AddBookmarkSheet). */}
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background },
          Platform.OS === "android" && { paddingTop: StatusBar.currentHeight ?? 0 },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" disabled={deleting}>
            <Text
              style={{
                fontSize: 17,
                color: colors.mutedForeground,
                opacity: deleting ? 0.5 : 1,
              }}
            >
              Cancel
            </Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Delete Account</Text>
          {/* Spacer so the title stays optically centered against "Cancel". */}
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View
            style={[
              styles.warning,
              {
                backgroundColor: colors.muted,
                borderColor: colors.destructive,
                borderRadius: radius.lg,
              },
            ]}
          >
            <Symbol
              name="exclamationmark.triangle.fill"
              size={20}
              color={colors.destructive}
              fallback="!"
            />
            <View style={styles.warningText}>
              <Text style={[styles.warningTitle, { color: colors.foreground }]}>
                This cannot be undone
              </Text>
              <Text style={[styles.warningBody, { color: colors.mutedForeground }]}>
                Deleting your account permanently removes your sign-in, every bookmark, every saved
                session, and your search history from Bookmark AI — on this phone and on every other
                device you use.
              </Text>
            </View>
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            TYPE {CONFIRM_WORD} TO CONFIRM
          </Text>
          <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.lg }]}>
            <TextInput
              value={typed}
              onChangeText={(t) => {
                setTyped(t);
                setError(null);
              }}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              editable={!deleting}
              returnKeyType="done"
              onSubmitEditing={() => void run()}
              accessibilityLabel={`Type ${CONFIRM_WORD} to confirm account deletion`}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          {email.length > 0 && (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Your email address ({email}) works too.
            </Text>
          )}

          <Pressable
            onPress={() => void run()}
            disabled={!armed}
            accessibilityRole="button"
            accessibilityState={{ disabled: !armed, busy: deleting }}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.destructive,
                borderRadius: radius.lg,
                opacity: armed ? (pressed ? 0.8 : 1) : 0.4,
              },
            ]}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.buttonLabel}>Delete My Account</Text>
            )}
          </Pressable>

          {error !== null && (
            <Text style={[styles.error, { color: colors.destructive }]}>
              Your account was NOT deleted: {error}
            </Text>
          )}

          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            Prefer to keep a copy? Export your data from the web app at bookmark-ai.cloud before
            deleting — the export is gone with the account.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerSpacer: { width: 52 },
  content: { padding: 20 },
  warning: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: { flex: 1, gap: 4 },
  warningTitle: { fontSize: 15, fontWeight: "600" },
  warningBody: { fontSize: 13, lineHeight: 18 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  field: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  // letterSpacing: 0 is explicit — iOS leaks the sign-in OTP field's tracking
  // (letterSpacing 6) into every later TextInput if none is declared.
  input: { flex: 1, fontSize: 17, paddingVertical: 11, letterSpacing: 0 },
  hint: { fontSize: 13, marginTop: 8, marginHorizontal: 4 },
  button: { alignItems: "center", justifyContent: "center", marginTop: 24, paddingVertical: 14 },
  buttonLabel: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  error: { fontSize: 15, lineHeight: 20, marginTop: 16, marginHorizontal: 4 },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 20, marginHorizontal: 4 },
});
