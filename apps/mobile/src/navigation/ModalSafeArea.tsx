import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Safe-area padding for the content of a FULL-SCREEN native `Modal` (top/left/
 * right — `bottom` is left to the content, which either ignores it or lets the
 * keyboard slide over it).
 *
 * Why this exists instead of a plain `<SafeAreaView edges={["top",…]}>`:
 *
 * On iOS a native `Modal` renders into its own UIWindow, a view hierarchy that
 * is NOT a superview-chain descendant of the app's root `SafeAreaProvider`.
 * `SafeAreaView` (RNCSafeAreaView) resolves its insets by walking `superview`
 * for the nearest provider and falling back to MEASURING ITSELF when it finds
 * none — which is exactly what happens inside a modal. That self-measurement
 * runs at `didMoveToWindow`, before the view has been laid out, and (unlike the
 * provider, which guards on a zero-size frame) it publishes whatever it reads.
 * In a modal that is frequently `UIEdgeInsetsZero`, so the first committed
 * layout has paddingTop: 0 and top-pinned chrome renders UNDER the status bar /
 * Dynamic Island — ~60pt too high, and a header button there is untappable, so
 * the user is stuck (QA: roughly half of fresh mounts on iPhone 17 / iOS 26.5).
 * Nothing corrects it either: only a provider posts the change notification, so
 * the wrong value survives until some unrelated re-render (a theme change, say)
 * happens to re-run the native update — the "it self-heals eventually" symptom.
 *
 * So the modal subtree gets its OWN `SafeAreaProvider`, which measures the
 * modal's window properly (and seeds itself from the parent context on the
 * first frame, so there is no zero-inset frame and no blank one), and padding
 * comes from `useSafeAreaInsets` in JS rather than from the racy native view.
 *
 * Do NOT swap this back to `SafeAreaView` — from `react-native-safe-area-context`
 * OR from `react-native` core — inside a `Modal`.
 */
export function ModalSafeArea({
  backgroundColor,
  children,
}: {
  backgroundColor: string;
  children: ReactNode;
}) {
  return (
    // The provider carries the background too: it is the modal's root view, and
    // it renders its children only once it has insets.
    <SafeAreaProvider style={{ backgroundColor }}>
      <ModalSafeAreaBody backgroundColor={backgroundColor}>{children}</ModalSafeAreaBody>
    </SafeAreaProvider>
  );
}

/** Split out because the insets have to be read UNDER the provider above. */
function ModalSafeAreaBody({
  backgroundColor,
  children,
}: {
  backgroundColor: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
