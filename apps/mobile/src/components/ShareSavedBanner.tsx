import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../context/PreferencesContext";
import type { ShareNotice } from "../lib/share-intent";
import { Symbol } from "./Symbol";

/**
 * The share-sheet confirmation: a floating card just under the status bar,
 * because a save that arrived from ANOTHER app has no on-screen control to
 * anchor to (the user never touched our UI). Tap to dismiss; it also
 * auto-dismisses once the scraped title lands (see useSharedLinkSave).
 */
export function ShareSavedBanner({
  notice,
  onDismiss,
}: {
  notice: ShareNotice;
  onDismiss: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  // The raw link is the only honest subtitle before the title lands.
  const subtitle = notice.title ?? notice.url.replace(/^https?:\/\//, "");

  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={notice.saving ? "Saving to Bookmark AI" : "Saved to Bookmark AI"}
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radius.xl,
            shadowColor: "#000",
          },
        ]}
      >
        {notice.saving ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Symbol name="checkmark.circle.fill" size={22} color={colors.foreground} fallback="✓" />
        )}
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {notice.saving ? "Saving to Bookmark AI…" : "Saved to Bookmark AI ✓"}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {subtitle}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600", letterSpacing: 0 },
  subtitle: { fontSize: 13, letterSpacing: 0 },
});
