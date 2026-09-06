import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../context/PreferencesContext";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { releaseNotesLine, type UpdateBannerModel } from "../lib/appUpdate";
import { Symbol } from "./Symbol";

const ENTER_MS = 240;
const EXIT_MS = 160;

/** The blocking variant's one line of copy — verbatim from CONTRACT §12. */
const UNSUPPORTED_COPY = "This version is no longer supported — update to keep syncing.";

/**
 * "Bookmark AI {version} is available" — the card at the top of Home when
 * `GET /api/app/releases` says a newer build exists for this platform (§12).
 * Same surface vocabulary as HomeContinueCard (card fill, hairline border, icon
 * tile). "Update" opens the store URL; "Later" snoozes for 24 h and is absent
 * on the `unsupported` variant, which cannot be dismissed. Slides in from just
 * above its resting place; the exit is a short fade so the list below doesn't
 * jump. Both are skipped under Reduce Motion.
 */
export function UpdateBanner({
  banner,
  onSnooze,
}: {
  banner: UpdateBannerModel;
  onSnooze: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);
  const { release, state } = banner;
  const blocking = state === "unsupported";
  const notes = releaseNotesLine(release.releaseNotes);

  useEffect(() => {
    if (leaving) return;
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const entrance = Animated.timing(progress, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    entrance.start();
    return () => entrance.stop();
  }, [leaving, progress, reduceMotion]);

  const update = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // On iOS an apps.apple.com URL opens the App Store; on Android a Play URL
    // opens Play. A refused URL is the store's problem, not a crash.
    void Linking.openURL(release.downloadUrl).catch(() => undefined);
  };

  const later = () => {
    if (leaving) return;
    void Haptics.selectionAsync();
    if (reduceMotion) {
      onSnooze();
      return;
    }
    setLeaving(true);
    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onSnooze());
  };

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
          ],
        },
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
          <Symbol
            name={blocking ? "exclamationmark.triangle" : "arrow.down.circle"}
            size={20}
            color={colors.foreground}
            fallback={blocking ? "!" : "↓"}
          />
        </View>
        <View style={styles.texts}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.foreground }]}>
            Bookmark AI {release.version} is available
          </Text>
          {blocking && (
            <Text style={[styles.body, { color: colors.foreground }]}>{UNSUPPORTED_COPY}</Text>
          )}
          {notes !== null && (
            <Text numberOfLines={1} style={[styles.body, { color: colors.mutedForeground }]}>
              {notes}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        {!blocking && (
          <Pressable
            onPress={later}
            disabled={leaving}
            accessibilityRole="button"
            accessibilityLabel="Later"
            accessibilityHint="Hides this update for a day"
            hitSlop={6}
            style={({ pressed }) => [
              styles.button,
              styles.ghost,
              { borderColor: colors.border, borderRadius: radius.md },
              pressed && { backgroundColor: colors.muted },
            ]}
          >
            <Text style={[styles.buttonLabel, { color: colors.foreground }]}>Later</Text>
          </Pressable>
        )}
        <Pressable
          onPress={update}
          accessibilityRole="button"
          accessibilityLabel={`Update to ${release.version}`}
          hitSlop={6}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>Update</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    marginHorizontal: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconTile: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  texts: { flex: 1, gap: 3, paddingTop: 1 },
  title: { fontSize: 16, fontWeight: "600", letterSpacing: -0.2, lineHeight: 21 },
  body: { fontSize: 14, lineHeight: 19 },
  // Right-aligned so the primary action sits on the card's trailing edge, the
  // way iOS puts the confirming button last.
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  button: {
    minHeight: 36,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  ghost: { borderWidth: StyleSheet.hairlineWidth },
  buttonLabel: { fontSize: 15, fontWeight: "600" },
});
