import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

/**
 * The "live right now" dot. Same visual language as the Sessions tab's device
 * dot (a filled `colors.foreground` circle — the palette is deliberately
 * neutral, so liveness is motion, not a green light), with a slow breathe so a
 * glance at Home tells you something is actually live.
 */
export function PulseDot({ size = 8, color }: { size?: number; color: string }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: pulse,
      }}
    />
  );
}

/** Stale counterpart: hollow ring, no motion (mirrors LiveDeviceSection). */
export function StaleDot({ size = 8, color }: { size?: number; color: string }) {
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderColor: color,
        borderWidth: 1.5,
      }}
    />
  );
}
