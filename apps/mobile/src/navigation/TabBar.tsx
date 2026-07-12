import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
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

const BAR_HEIGHT = 64;
const BAR_GAP = 16; // gap between bar bottom and safe-area/home indicator

function bottomOffset(insetBottom: number): number {
  return Math.max(insetBottom, BAR_GAP);
}

/** Bottom padding screens need so scrollable content clears the floating bar
 * (content deliberately scrolls UNDER the glass). */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return bottomOffset(insets.bottom) + BAR_HEIGHT + 20;
}

/**
 * Floating tab bar, iOS 26 style: a detached capsule hovering above the home
 * indicator. Real Liquid Glass (UIGlassEffect) where the OS has it; a frosted
 * blur capsule everywhere else (iOS 18, Android) so the design reads the same
 * on every OS version.
 */
export function TabBar({ tab, onChange }: { tab: TabKey; onChange: (tab: TabKey) => void }) {
  const { colors, dark } = useAppTheme();
  const insets = useSafeAreaInsets();

  const items = TABS.map(({ key, label, symbol, activeSymbol, fallback }) => {
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
        <View
          style={[
            styles.tabInner,
            active && {
              backgroundColor: dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.07)",
            },
          ]}
        >
          <Symbol
            name={active ? activeSymbol : symbol}
            size={22}
            color={color}
            fallback={fallback}
            weight={active ? "semibold" : "regular"}
          />
          <Text style={[styles.label, { color, fontWeight: active ? "600" : "500" }]}>
            {label}
          </Text>
        </View>
      </Pressable>
    );
  });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: bottomOffset(insets.bottom) }]}
    >
      <View style={styles.shadow}>
        {isLiquidGlassAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.bar}>
            {items}
          </GlassView>
        ) : (
          <BlurView
            intensity={90}
            tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
            experimentalBlurMethod="dimezisBlurView"
            style={[
              styles.bar,
              styles.frosted,
              {
                borderColor: colors.border,
                backgroundColor: dark ? "rgba(18,18,18,0.55)" : "rgba(252,252,252,0.6)",
              },
            ]}
          >
            {items}
          </BlurView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  shadow: {
    width: "100%",
    maxWidth: 420, // keeps the capsule sane on iPad
    borderRadius: BAR_HEIGHT / 2,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  frosted: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabInner: {
    alignItems: "center",
    gap: 2,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 72,
  },
  label: { fontSize: 10 },
});
