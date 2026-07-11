import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { SymbolViewProps } from "expo-symbols";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "../components/Symbol";

export type TabKey = "library" | "search" | "settings";

const TABS: {
  key: TabKey;
  label: string;
  symbol: SymbolViewProps["name"];
  activeSymbol: SymbolViewProps["name"];
  fallback: string;
}[] = [
  {
    key: "library",
    label: "Library",
    symbol: "books.vertical",
    activeSymbol: "books.vertical.fill",
    fallback: "▤",
  },
  {
    key: "search",
    label: "Search",
    symbol: "magnifyingglass",
    activeSymbol: "magnifyingglass",
    fallback: "⌕",
  },
  {
    key: "settings",
    label: "Settings",
    symbol: "gearshape",
    activeSymbol: "gearshape.fill",
    fallback: "⚙",
  },
];

/** Bottom tab bar (iOS top-level navigation) — three tabs, SF Symbols,
 * selection haptics, safe-area aware. */
export function TabBar({ tab, onChange }: { tab: TabKey; onChange: (tab: TabKey) => void }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {TABS.map(({ key, label, symbol, activeSymbol, fallback }) => {
        const active = key === tab;
        const color = active ? colors.foreground : colors.mutedForeground;
        return (
          <Pressable
            key={key}
            onPress={() => {
              if (!active) {
                void Haptics.selectionAsync();
                onChange(key);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={styles.tab}
          >
            <Symbol
              name={active ? activeSymbol : symbol}
              size={24}
              color={color}
              fallback={fallback}
              weight={active ? "semibold" : "regular"}
            />
            <Text style={[styles.label, { color, fontWeight: active ? "600" : "400" }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: "center", gap: 3 },
  label: { fontSize: 10 },
});
