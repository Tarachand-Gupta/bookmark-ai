import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";

/**
 * PROVISIONING SCREEN — the mobile twin of the web's AccountSetup
 * (apps/web/components/library/account-setup.tsx). Shown while a brand-new
 * account's own database is being created, i.e. whenever the API answers 503
 * `{code:"provisioning"}` (see useAccountStatus, which polls every 2s and swaps
 * this out for the tab shell the moment a request succeeds).
 *
 * It owns the whole screen instead of rendering inside a tab: a half-built shell
 * — empty Home rows, skeleton cards, a tab bar that leads to five failing
 * screens — reads as a broken app, and this is the first thing a new signup ever
 * sees. Owning the screen also lets it carry the brand mark, same treatment as
 * the sign-in hero.
 *
 * Tone matches the web word for word: a normal 10-15 seconds of signup, never an
 * error. No destructive color, no warning glyph, no retry button (the 2s poll IS
 * the retry). The privacy line is the honest reason the wait exists at all.
 */
export function AccountSetupScreen() {
  const { colors, radius } = useAppTheme();

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Setting up your account"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.brand}>
        <View style={[styles.mark, { backgroundColor: colors.primary, borderRadius: radius.lg }]}>
          <Symbol name="bookmark.fill" size={20} color={colors.primaryForeground} fallback="B" />
        </View>
        <Text style={[styles.brandText, { color: colors.foreground }]}>Bookmark AI</Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.xl },
        ]}
      >
        <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>
          Setting up your account
        </Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          This usually takes 10–15 seconds.
        </Text>
        {/* Indeterminate on purpose: provisioning reports no percentage, and a
            fake bar that stalls at 90% is worse than honest motion. The web uses
            a travelling CSS sliver; the platform spinner is the native
            equivalent and needs no animation code of our own. */}
        <ActivityIndicator style={styles.spinner} color={colors.mutedForeground} />
      </View>

      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        We take privacy seriously — every account gets its own isolated database, and we’re
        creating yours right now.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24, padding: 28 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  brandText: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  card: {
    width: "100%",
    maxWidth: 360,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  cardBody: { fontSize: 15, textAlign: "center", marginTop: 4, lineHeight: 20 },
  spinner: { marginTop: 18 },
  footnote: { fontSize: 13, textAlign: "center", maxWidth: 320, lineHeight: 19 },
});
