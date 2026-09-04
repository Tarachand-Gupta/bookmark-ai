import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SymbolViewProps } from "expo-symbols";
import { useAppTheme } from "../../context/PreferencesContext";
import { Symbol } from "../Symbol";

/**
 * The iOS inset-grouped list vocabulary Settings is built from: an uppercase
 * section label, a card-surfaced group, and rows (icon · label · detail ·
 * trailing/chevron) with a pressed state. Shared so the Plan and Ask AI
 * sections read exactly like the rest of the screen.
 */
export function GroupLabel({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return (
    <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
      {children.toUpperCase()}
    </Text>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.group,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      {children}
    </View>
  );
}

export function GroupRow({
  label,
  detail,
  symbol,
  trailing,
  chevron,
  first,
  destructive,
  onPress,
}: {
  label: string;
  detail?: string;
  symbol?: SymbolViewProps["name"];
  trailing?: ReactNode;
  chevron?: boolean;
  first?: boolean;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const labelColor = destructive ? colors.destructive : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && onPress ? { backgroundColor: colors.muted } : null,
      ]}
    >
      {symbol && (
        <Symbol
          name={symbol}
          size={20}
          color={destructive ? colors.destructive : colors.mutedForeground}
          fallback="•"
        />
      )}
      <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
      {detail && (
        <Text numberOfLines={1} style={[styles.rowDetail, { color: colors.mutedForeground }]}>
          {detail}
        </Text>
      )}
      {trailing}
      {chevron && <Symbol name="chevron.right" size={14} color={colors.mutedForeground} fallback="›" />}
    </Pressable>
  );
}

/** Small print under a group. */
export function GroupFootnote({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.footnote, { color: colors.mutedForeground }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  groupLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowLabel: { flex: 1, fontSize: 17 },
  rowDetail: { fontSize: 15, maxWidth: "50%" },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 10, marginHorizontal: 4 },
});
