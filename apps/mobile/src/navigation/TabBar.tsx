import { useRef, type RefObject } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import type { SymbolViewProps } from "expo-symbols";
import { useAppTheme } from "../context/PreferencesContext";
import { Symbol } from "../components/Symbol";

export type TabKey = "home" | "library" | "sessions" | "search" | "chat";

// Order is priority (docs/features/dashboard.md §4): Home lands first, the
// storage/browse views follow, and Ask AI closes the row. Settings is NOT a tab
// — it's a full-screen presentation opened from Home's title row (App.tsx), so
// the fifth slot goes to a destination people actually use daily.
const TABS: {
  key: TabKey;
  label: string;
  symbol: SymbolViewProps["name"];
  activeSymbol: SymbolViewProps["name"];
  fallback: string;
}[] = [
  {
    key: "home",
    label: "Home",
    symbol: "house",
    activeSymbol: "house.fill",
    fallback: "⌂",
  },
  {
    key: "library",
    label: "Library",
    symbol: "books.vertical",
    activeSymbol: "books.vertical.fill",
    fallback: "▤",
  },
  {
    // The radio icon, not the old card stack: the tab now leads with the LIVE
    // segment, and `square.stack` moved onto the Saved segment inside it.
    key: "sessions",
    label: "Sessions",
    symbol: "dot.radiowaves.left.and.right",
    activeSymbol: "dot.radiowaves.left.and.right",
    fallback: "◉",
  },
  {
    key: "search",
    label: "Search",
    symbol: "magnifyingglass",
    activeSymbol: "magnifyingglass",
    fallback: "⌕",
  },
  {
    // `sparkles` has no .fill variant either — same glyph both states.
    key: "chat",
    label: "Ask AI",
    symbol: "sparkles",
    activeSymbol: "sparkles",
    fallback: "✦",
  },
];

const BAR_HEIGHT = 64;
const COLLAPSED_SCALE = 0.84;

// ── Floating geometry (shared by BOTH states) ──────────────────────────────
// SCREEN_MARGIN is the ONE margin the capsule keeps from every screen edge —
// including the bottom, measured from the PHYSICAL screen edge, not the safe
// area. That's the Instagram treatment (owner-approved reference): the pill
// dips into the home-indicator band with the same 12pt gap it keeps at the
// sides. Both `inset + margin` (floats too high, looks detached from the
// screen) and `max(inset, gap)` (parks the edge exactly on the indicator
// band) were tried and rejected — do not "fix" this back to inset math.
const SCREEN_MARGIN = 12; // breathing room the capsule keeps from each screen edge
const CONTENT_GAP = 20; // extra scroll padding below the bar

// Item sizing. Fixed-width items keep the pill highlight the same distance from
// the capsule's rounded ends on every tab, but a fifth tab (Home) no longer fits
// at a hard 82pt on a 375pt iPhone SE — so the width is derived from the screen
// and only shrinks where it has to (phones stay ≥ 56pt, iPads keep the full 82).
const TAB_WIDTH_MAX = 82;
const TAB_WIDTH_MIN = 56;
const BAR_PADDING = 8; // capsule's own horizontal padding
const TAB_GAP = 4;

function tabWidth(windowWidth: number, count: number): number {
  const available =
    windowWidth - SCREEN_MARGIN * 2 - BAR_PADDING * 2 - TAB_GAP * Math.max(0, count - 1);
  return Math.max(TAB_WIDTH_MIN, Math.min(TAB_WIDTH_MAX, Math.floor(available / count)));
}

/** Distance from the screen bottom to the capsule's bottom edge — the same in the
 * expanded and collapsed states (the collapse only scales the pill, anchored on
 * this edge, see `barShift`), so the bar never jumps while animating. Ignores the
 * safe-area inset on purpose: the pill lives inside the home-indicator band. */
function bottomOffset(): number {
  return SCREEN_MARGIN;
}

/** Bottom padding screens need so scrollable content clears the floating bar
 * (content deliberately scrolls UNDER the glass). */
export function useTabBarClearance(): number {
  return bottomOffset() + BAR_HEIGHT + CONTENT_GAP;
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
export function TabBar({
  tab,
  onChange,
  blurTarget,
}: {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
  /** Android live-blur source (a BlurTargetView wrapping the screens). */
  blurTarget?: RefObject<View | null>;
}) {
  const { colors, dark } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const itemWidth = tabWidth(windowWidth, TABS.length);

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
          { width: itemWidth },
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
      style={[styles.wrap, { bottom: bottomOffset() }]}
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
            // Android: RenderNode-based live blur of the screen content
            // (falls back to the translucent fill below Android 12)
            blurMethod="dimezisBlurViewSdk31Plus"
            blurTarget={blurTarget}
            style={[
              styles.bar,
              styles.frosted,
              {
                borderColor: colors.border,
                // Android gets real blur behind, so its overlay is lighter
                backgroundColor: dark
                  ? `rgba(18,18,18,${Platform.OS === "android" ? 0.35 : 0.55})`
                  : `rgba(252,252,252,${Platform.OS === "android" ? 0.35 : 0.6})`,
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
    // Same SCREEN_MARGIN the width math assumes, enforced in layout as well, so
    // the capsule's side gaps can never end up smaller than its bottom one.
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
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
    paddingHorizontal: BAR_PADDING,
    gap: TAB_GAP,
  },
  frosted: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Uniform insets; the width comes from tabWidth() at render time (see above).
  tab: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    // concrete radius: Android renders huge (999) radii as sharp corners here
    borderRadius: 24,
  },
  label: { fontSize: 10 },
});
