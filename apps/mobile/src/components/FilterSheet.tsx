import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { MetaResponse } from "@bookmark-ai/types";
import type { LibraryFilters } from "../api";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "./Symbol";

/** Native bottom sheet (pageSheet modal, drag-to-dismiss) with the FULL
 * facet lists — categories as check rows, all tags and days as wrap chips.
 * This replaces the web-ish stacked chip rails. */
export function FilterSheet({
  visible,
  onClose,
  meta,
  filters,
  onFilter,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  meta: MetaResponse | null;
  filters: LibraryFilters;
  onFilter: (key: keyof LibraryFilters, value: string | undefined) => void;
  onClear: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const activeCount = Object.values(filters).filter(Boolean).length;

  const pick = (key: keyof LibraryFilters, value: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onFilter(key, value);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={activeCount > 0 ? onClear : undefined}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text
              style={{
                fontSize: 17,
                color: activeCount > 0 ? colors.destructive : colors.mutedForeground,
                opacity: activeCount > 0 ? 1 : 0.5,
              }}
            >
              Clear
            </Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.section, { color: colors.mutedForeground }]}>CATEGORY</Text>
          <View
            style={[
              styles.group,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
            ]}
          >
            {(meta?.categories ?? []).map((c, i) => {
              const selected = filters.category === c.name;
              return (
                <Pressable
                  key={c.name}
                  onPress={() => pick("category", c.name)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.groupRow,
                    i > 0 && {
                      borderTopColor: colors.border,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text style={[styles.groupRowText, { color: colors.foreground }]}>{c.name}</Text>
                  <Text style={{ fontSize: 15, color: colors.mutedForeground }}>{c.count}</Text>
                  <View style={styles.check}>
                    {selected && (
                      <Symbol name="checkmark" size={16} color={colors.foreground} fallback="✓" weight="semibold" />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.section, { color: colors.mutedForeground }]}>TAGS</Text>
          <View style={styles.wrap}>
            {(meta?.tags ?? []).map((t) => (
              <WrapChip
                key={t.name}
                label={t.name}
                selected={filters.tag === t.name}
                onPress={() => pick("tag", t.name)}
              />
            ))}
          </View>

          <Text style={[styles.section, { color: colors.mutedForeground }]}>SAVED ON</Text>
          <View style={styles.wrap}>
            {(meta?.days ?? []).map((d) => (
              <WrapChip
                key={d.day}
                label={`${formatDay(d.day)} · ${d.count}`}
                selected={filters.day === d.day}
                onPress={() => pick("day", d.day)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function WrapChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.card,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={{ fontSize: 15, color: selected ? colors.primaryForeground : colors.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  content: { padding: 20, paddingBottom: 48 },
  section: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 20,
  },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  groupRowText: { flex: 1, fontSize: 17 },
  check: { width: 22, alignItems: "flex-end" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
