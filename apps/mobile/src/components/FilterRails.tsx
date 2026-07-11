import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { MetaResponse } from "@bookmark-ai/types";
import type { LibraryFilters } from "../api";
import { useTheme } from "../theme";
import { Chip } from "./Chip";

/** The web sidebar's facets as horizontal chip rails: category, tag, day.
 * Tapping a selected chip clears that filter. */
export function FilterRails({
  meta,
  filters,
  onFilter,
}: {
  meta: MetaResponse | null;
  filters: LibraryFilters;
  onFilter: (key: keyof LibraryFilters, value: string | undefined) => void;
}) {
  const { colors } = useTheme();
  if (!meta) return null;

  const rails: {
    key: keyof LibraryFilters;
    label: string;
    items: { value: string; label: string }[];
  }[] = [
    {
      key: "category",
      label: "Categories",
      items: meta.categories.map((c) => ({ value: c.name, label: `${c.name} · ${c.count}` })),
    },
    {
      key: "tag",
      label: "Tags",
      items: meta.tags.map((t) => ({ value: t.name, label: t.name })),
    },
    {
      key: "day",
      label: "Days",
      items: meta.days.map((d) => ({ value: d.day, label: formatDay(d.day) })),
    },
  ];

  return (
    <View style={styles.wrap}>
      {rails.map(
        (rail) =>
          rail.items.length > 0 && (
            <View key={rail.key} style={styles.rail}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>{rail.label}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                {rail.items.map((item) => (
                  <Chip
                    key={item.value}
                    label={item.label}
                    selected={filters[rail.key] === item.value}
                    onPress={() => onFilter(rail.key, item.value)}
                  />
                ))}
              </ScrollView>
            </View>
          ),
      )}
    </View>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  rail: { gap: 4 },
  label: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  chips: { flexDirection: "row", gap: 6, paddingRight: 16 },
});
