import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { SymbolViewProps } from "expo-symbols";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";

/**
 * The Ongoing segment's zero-card states (§4.7). "All stale" (C) is not here:
 * a device old enough to matter is still within the 7-day TTL, so the server
 * still returns it and it renders as a dimmed, hollow-dot card — the mock's
 * exact treatment. Only truly card-less states need copy:
 *   off          → A (the default; teach, link to Settings)
 *   no-device    → B (armed, nothing has checked in)
 *   provisioning → D (tenant DB still being created)
 *   error        → a soft first-load failure with a retry
 */
export type LiveEmptyKind = "off" | "no-device" | "provisioning" | "error";

export function LiveEmptyState({
  kind,
  message,
  onOpenSettings,
  onRetry,
}: {
  kind: LiveEmptyKind;
  message?: string;
  onOpenSettings?: () => void;
  onRetry?: () => void;
}) {
  const { colors, radius } = useAppTheme();

  if (kind === "provisioning") {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={colors.mutedForeground} />
        <Text style={[styles.body, { color: colors.mutedForeground }]}>Setting up your account…</Text>
      </View>
    );
  }

  const copy: {
    icon: SymbolViewProps["name"];
    fallback: string;
    title: string;
    body: string;
  } =
    kind === "off"
      ? {
          icon: "eye.slash",
          fallback: "🚫",
          title: "Open tabs are off",
          body: "Turn on Show my open tabs in Settings and your browser will show you what it has open here — nothing is saved until you tap Save.",
        }
      : kind === "error"
        ? {
            icon: "questionmark.circle",
            fallback: "?",
            title: "Couldn't load open tabs",
            body: message ?? "Check your connection and try again.",
          }
        : {
            icon: "laptopcomputer",
            fallback: "🖥",
            title: "No devices yet",
            body: "Install the Bookmark AI extension on the browser you want to see here, then turn on Show my open tabs in the extension.",
          };

  return (
    <View style={styles.root}>
      <Symbol name={copy.icon} size={28} color={colors.mutedForeground} fallback={copy.fallback} />
      <Text style={[styles.title, { color: colors.foreground }]}>{copy.title}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{copy.body}</Text>
      {kind === "off" && onOpenSettings && (
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.button,
            { borderColor: colors.border, borderRadius: radius.md },
            pressed && { backgroundColor: colors.muted },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: colors.foreground }]}>Open Settings</Text>
        </Pressable>
      )}
      {kind === "error" && onRetry && (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.button,
            { borderColor: colors.border, borderRadius: radius.md },
            pressed && { backgroundColor: colors.muted },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: colors.foreground }]}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 10, paddingVertical: 72, paddingHorizontal: 24 },
  title: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
  button: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonLabel: { fontSize: 15, fontWeight: "500" },
});
