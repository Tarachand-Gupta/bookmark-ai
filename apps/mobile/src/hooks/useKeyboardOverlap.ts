import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from "react-native";

/** The keyboard's current coverage of the window bottom, from the OS's own metrics. */
function currentOverlap(): number {
  if (!Keyboard.isVisible()) return 0;
  const metrics = Keyboard.metrics();
  if (metrics === undefined) return 0;
  return Platform.OS === "ios" ? overlapFor(metrics.screenY) : metrics.height;
}

/**
 * iOS reports keyboard frames in the KEY WINDOW's coordinate space
 * (RCTKeyboardObserver converts from screen coords), and inside a full-screen
 * native `Modal` that window is the modal's own — the same space
 * `Dimensions.get("window")` describes. So "how much of the bottom of the screen
 * is covered" is just window height minus the keyboard's top edge, and it
 * INCLUDES the QuickType/predictive strip and any inputAccessoryView, because
 * those are part of the reported keyboard frame.
 */
function overlapFor(keyboardScreenY: number): number {
  return Math.max(0, Dimensions.get("window").height - keyboardScreenY);
}

/**
 * How many points of the window bottom the software keyboard currently covers
 * (0 = hidden), animated in step with the keyboard's own curve and duration.
 *
 * Use this instead of `KeyboardAvoidingView` for anything that does NOT sit at
 * the root of the screen. `KeyboardAvoidingView` computes its padding as
 * `frame.y + frame.height - keyboardScreenY`, where `frame` comes from its own
 * `onLayout` — i.e. coordinates relative to its PARENT, compared against a
 * window-space keyboard edge. Every point of ancestor offset above it (a header,
 * a safe-area paddingTop) therefore silently subtracts from the avoidance, and
 * you are expected to hand that difference back via `keyboardVerticalOffset`,
 * which nobody can keep correct across devices. Reading the real frame has no
 * such constant to get wrong.
 *
 * The consumer applies the result at the bottom of a container that reaches the
 * window bottom. How it combines with the bottom safe-area inset differs per
 * platform: on iOS the keyboard frame already spans the home-indicator area, so
 * `max(overlap, insets.bottom)` is the pad; on Android the reported height is
 * the IME MINUS the system-bar inset (ReactRootView subtracts it), so in an
 * edge-to-edge window the two ADD — see ChatThread.
 */
export function useKeyboardOverlap(): number {
  // Seeded, not zero: the keyboard can already be up when this mounts (a modal
  // opened from a focused field), and then no event is coming.
  const [overlap, setOverlap] = useState(currentOverlap);

  useEffect(() => {
    if (Platform.OS === "android") {
      // Edge-to-edge (SDK 57 / target 35) leaves a full-screen native Modal's
      // window alone when the keyboard opens — `adjustResize` no longer resizes
      // it — so the keyboard's own height is exactly how much of the bottom it
      // covers. Android has no "will" phase; the did-events land with the frame.
      const subscriptions = [
        Keyboard.addListener("keyboardDidShow", (event) => {
          setOverlap(event.endCoordinates.height);
        }),
        Keyboard.addListener("keyboardDidHide", () => {
          setOverlap(0);
        }),
      ];
      return () => {
        for (const subscription of subscriptions) subscription.remove();
      };
    }

    const settle = (event: KeyboardEvent, next: number) => {
      // Ride the keyboard's own duration/easing rather than snapping — this is
      // the same LayoutAnimation KeyboardAvoidingView schedules.
      Keyboard.scheduleLayoutAnimation(event);
      setOverlap(next);
    };

    const subscriptions = [
      Keyboard.addListener("keyboardWillChangeFrame", (event) => {
        settle(event, overlapFor(event.endCoordinates.screenY));
      }),
      // Undocked / split / floating keyboards (iPad) report a frame that looks
      // on-screen; iOS follows the frame change with willHide, which is the
      // authoritative "not covering the app" signal, so it wins by arriving last.
      Keyboard.addListener("keyboardWillHide", (event) => {
        settle(event, 0);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  return overlap;
}
