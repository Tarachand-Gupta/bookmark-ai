import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
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
const COLLAPSED_SCALE = 0.84;

function bottomOffset(insetBottom: number): number {
  return Math.max(insetBottom, BAR_GAP);
}

/** Bottom padding screens need so scrollable content clears the floating bar
 * (content deliberately scrolls UNDER the glass). */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return bottomOffset(insets.bottom) + BAR_HEIGHT + 20;
}

// Instagram-style shrink: one shared animated scale for the single tab bar.
const barScale = new Animated.Value(1);
// Keep the bottom edge anchored while scaling (default origin is the center).
const barShift = barScale.interpolate({
  inputRange: [COLLAPSED_SCALE, 1],
  outputRange: [(BAR_HEIGHT * (1 - COLLAPSED_SCALE)) / 2, 0],
});
let barCollapsed = false;

function setBarCollapsed(next: boolean) {
  if (barCollapsed === next) return;
  barCollapsed = next;
  Animated.spring(barScale, {
    toValue: next ? COLLAPSED_SCALE : 1,
    useNativeDriver: true,
    speed: 18,
    bounciness: 5,
  }).start();
}

/**
 * Scroll handler for screens: shrink the tab bar while scrolling down,
 * restore it on scroll-up or near the top. Attach to any scrollable:
 * `onScroll={useTabBarScroll()} scrollEventThrottle={16}`.
 */
export function useTabBarScroll() {
  const lastY = useRef(0);
  return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    if (y <= 24) setBarCollapsed(false);
    else if (dy > 4) setBarCollapsed(true);
    else if (dy < -4) setBarCollapsed(false);
  };
}

/**
 * Floating tab bar, iOS 26 style: a detached capsule hovering above the home
 * indicator, sized to its content (fixed-width items, not stretched), that
 * scales down while the user scrolls. Real Liquid Glass (UIGlassEffect) where
 * the OS has it; a frosted blur capsule everywhere else (iOS 18, Android) so
 * the design reads the same on every OS version.
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
            setBarCollapsed(false); // switching tabs always restores the bar
            onChange(key);
          }
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        style={[
          styles.tab,
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
      </Pressable>
    );
  });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: bottomOffset(insets.bottom) }]}
    >
      <Animated.View
        style={[styles.shadow, { transform: [{ translateY: barShift }, { scale: barScale }] }]}
      >
        {isLiquidGlassAvailable() ? (
          <GlassView glassEffectStyle="regular" style={styles.bar}>
            {items}
          </GlassView>
        ) : (
          <BlurView
            intensity={90}
            tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center", // the capsule hugs its content, centered
  },
  shadow: {
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
    gap: 4,
  },
  frosted: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Fixed-size items with uniform insets — the pill highlight keeps the same
  // distance from the capsule's rounded ends on every tab.
  tab: {
    width: 92,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    // concrete radius: Android renders huge (999) radii as sharp corners here
    borderRadius: 24,
  },
  label: { fontSize: 10 },
});
