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
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { createBookmark, CURRENT_DEVICE } from "../api";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";

/** "https://x.co" from "x.co"; null when the text can't be a URL at all. */
function normalizeUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed) || !trimmed.includes(".")) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/** Native save sheet: URL (+ optional title) → POST /api/bookmarks. The
 * server fills in OG data, category, and tags, so this stays a two-field form. */
export function AddBookmarkSheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setUrl("");
      setTitle("");
      setError(null);
      setSaving(false);
    }
  }, [visible]);

  const normalized = normalizeUrl(url);
  const canSave = normalized !== null && !saving;

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => "");
    if (text) setUrl(text.trim());
  };

  const save = async () => {
    if (!normalized) return;
    setSaving(true);
    setError(null);
    try {
      await createBookmark({
        url: normalized,
        title: title.trim() || undefined,
        browser: "other", // saved from the app, not a browser
        // one source of truth for this build's device class — the dashboard
        // sends the same value as ?device= so it can exclude our own saves
        device: CURRENT_DEVICE,
        deviceName: Platform.OS === "ios" ? (Platform.isPad ? "iPad" : "iPhone") : "Android",
        os: Platform.OS,
        savedAt: new Date().toISOString(),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {/* pageSheet is iOS-only; on Android the modal is fullscreen, so pad
          the header below the status bar. */}
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background },
          Platform.OS === "android" && { paddingTop: StatusBar.currentHeight ?? 0 },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" disabled={saving}>
            <Text style={{ fontSize: 17, color: colors.mutedForeground }}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>New Bookmark</Text>
          <Pressable onPress={save} hitSlop={8} accessibilityRole="button" disabled={!canSave}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: "600",
                  color: canSave ? colors.foreground : colors.mutedForeground,
                  opacity: canSave ? 1 : 0.5,
                }}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.mutedForeground }]}>LINK</Text>
          <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.lg }]}>
            <Symbol name="globe" size={17} color={colors.mutedForeground} fallback="○" />
            <TextInput
              value={url}
              onChangeText={(t) => {
                setUrl(t);
                setError(null);
              }}
              placeholder="example.com/article"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType="url"
              returnKeyType="done"
              editable={!saving}
              style={[styles.input, { color: colors.foreground }]}
            />
            <Pressable onPress={() => void paste()} hitSlop={8} accessibilityLabel="Paste link">
              <Symbol name="doc.on.clipboard" size={18} color={colors.mutedForeground} fallback="⧉" />
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            TITLE · OPTIONAL
          </Text>
          <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.lg }]}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Filled in automatically if left empty"
              placeholderTextColor={colors.mutedForeground}
              editable={!saving}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          {error !== null && (
            <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          )}
          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            The page's preview, category, and tags are fetched and filled in automatically after
            saving. Re-saving a link you already have updates it instead of duplicating.
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
  content: { padding: 20, gap: 8 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginTop: 12,
    marginLeft: 4,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  // letterSpacing: 0 is explicit — iOS leaks the sign-in OTP field's tracking
  // (letterSpacing 6) into every later TextInput if none is declared.
  input: { flex: 1, fontSize: 17, paddingVertical: 11, letterSpacing: 0 },
  error: { fontSize: 15, marginTop: 12, marginLeft: 4 },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 16, marginHorizontal: 4 },
});
