import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { ShimmerText } from "./ShimmerText";

/**
 * The instant placeholder for an assistant turn: rendered the moment the user
 * sends (status `submitted`, no parts yet) and until the first token/tool/thought
 * lands — a shimmering "Thinking" plus three quietly pulsing dots, so the
 * thread never sits still after a send.
 */
export function ChatThinking() {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessibilityLabel="Thinking">
      <ShimmerText style={styles.label} color={colors.mutedForeground} highlight={colors.foreground}>
        Thinking
      </ShimmerText>
      <Dots color={colors.mutedForeground} />
    </View>
  );
}

function Dots({ color }: { color: string }) {
  const reduceMotion = useReducedMotion();
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loops = values.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(value, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.3,
            duration: 300,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((2 - i) * 160 + 240),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [reduceMotion, values]);

  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no">
      {values.map((opacity, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { backgroundColor: color, opacity: reduceMotion ? 0.5 : opacity }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  label: { fontSize: 15, fontWeight: "500" },
  dots: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
