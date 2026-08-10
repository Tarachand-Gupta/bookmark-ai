import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";

/**
 * One Home section: an uppercase label (same type as the Library's day headers
 * and Search's result labels) with an optional trailing link, over full-bleed
 * rows. Sections render only when they have data — the caller decides; this
 * component never draws an empty shell (§1.3 "empty cards are forbidden").
 */
export function HomeSection({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{title}</Text>
        {actionLabel !== undefined && onAction !== undefined && (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onAction();
            }}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.5 }]}
          >
            <Text style={[styles.actionText, { color: colors.foreground }]}>{actionLabel}</Text>
            <Symbol name="chevron.right" size={12} color={colors.mutedForeground} fallback="›" />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 22 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  action: { flexDirection: "row", alignItems: "center", gap: 3 },
  actionText: { fontSize: 15, fontWeight: "500" },
});
