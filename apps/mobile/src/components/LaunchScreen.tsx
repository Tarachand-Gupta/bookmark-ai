import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";

// The SAME assets the native splash uses (app.json → expo-splash-screen:
// `image` / `dark.image`, `imageWidth: 128`, contain).
const MARK_LIGHT = require("../../assets/splash-icon.png");
const MARK_DARK = require("../../assets/splash-icon-dark.png");

/** app.json → expo-splash-screen `imageWidth` — keep the two in lockstep. */
const MARK_SIZE = 128;

/**
 * In-app twin of the native splash: same mark, same size, same centre, same
 * background — plus a spinner below it.
 *
 * It exists so the native splash can be dismissed on the app's FIRST painted
 * frame instead of being held up until Clerk has finished its cold-start
 * network round trip. The handoff is invisible (identical pixels, and the
 * splash cross-fades out over 250ms), while the spinner finally gives the
 * launch some motion — the old behaviour froze a static image on screen for as
 * long as the session restore took, then up to a 4s ceiling.
 *
 * Shown while: persisted preferences are being read, Clerk is restoring the
 * session, and a signed-in account is being classified (see App.tsx Gate).
 */
export function LaunchScreen() {
  const { colors, dark } = useAppTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Image
        source={dark ? MARK_DARK : MARK_LIGHT}
        style={styles.mark}
        resizeMode="contain"
        // Decorative: the sign-in screen right behind it names the app.
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {/* Absolutely positioned so the mark stays EXACTLY where the native
          splash drew it — a spinner in normal flow would shift it upwards and
          make the handoff visible as a jump. */}
      <View style={styles.spinner}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  mark: { width: MARK_SIZE, height: MARK_SIZE },
  spinner: { position: "absolute", bottom: "22%" },
});
