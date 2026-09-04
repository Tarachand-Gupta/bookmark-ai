import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/**
 * A label with a soft highlight sweeping across it — the "working on it" cue
 * for Thinking placeholders and streaming reasoning, matching the web thread's
 * shimmer. Built from RN primitives only: the base text in the muted colour,
 * and a narrow window (overflow hidden, translated across) holding a second copy
 * in the highlight colour, counter-translated so the two copies stay aligned.
 * Honours Reduce Motion (static text).
 */
export function ShimmerText({
  children,
  style,
  color,
  highlight,
  active = true,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  /** Resting text colour. */
  color: string;
  /** Colour of the sweeping highlight. */
  highlight: string;
  /** false = plain text, no animation (a finished state that keeps the layout). */
  active?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const animating = active && !reduceMotion && width > 0;

  useEffect(() => {
    if (!animating) return;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [animating, progress]);

  const band = Math.max(28, Math.round(width * 0.45));
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-band, width] });
  const counter = Animated.multiply(translateX, -1);

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <Text style={[style, { color }]} numberOfLines={1}>
        {children}
      </Text>
      {animating && (
        <Animated.View
          pointerEvents="none"
          style={[styles.band, { width: band, transform: [{ translateX }] }]}
        >
          <Animated.Text
            numberOfLines={1}
            style={[style, { color: highlight, width, transform: [{ translateX: counter }] }]}
          >
            {children}
          </Animated.Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start", overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0, left: 0, overflow: "hidden" },
});
