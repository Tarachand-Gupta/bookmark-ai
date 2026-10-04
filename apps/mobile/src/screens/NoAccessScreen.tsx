import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";

/** A valid signed-in account was denied access by the API. Offer a recheck
 * and an explicit account switch without treating it as a network failure. */
export function NoAccessScreen({ onRecheck }: { onRecheck: () => void }) {
  const { colors, radius } = useAppTheme();
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const email = user?.email ?? null;

  const handleSignOut = () => {
    setBusy(true);
    void signOut().catch(() => { setBusy(false); Alert.alert("Couldn't sign out", "Check your connection and retry."); });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.badge, { backgroundColor: colors.muted }]}>
        <Symbol
          name="exclamationmark.shield"
          size={26}
          color={colors.mutedForeground}
          fallback="!"
        />
      </View>

      <Text style={[styles.title, { color: colors.foreground }]}>
        This account doesn’t have access
      </Text>

      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {email ? (
          <>
            You’re signed in as{" "}
            <Text style={[styles.email, { color: colors.foreground }]}>{email}</Text>, which isn’t
            authorized to use this app.
          </>
        ) : (
          <>This account isn’t authorized to use this app.</>
        )}{" "}
        Sign out and use an account that has access.
      </Text>

      <Pressable
        onPress={handleSignOut}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primaryBtn,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.lg,
            opacity: busy ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Symbol
          name="rectangle.portrait.and.arrow.right"
          size={17}
          color={colors.primaryForeground}
          fallback="→"
        />
        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Sign out</Text>
      </Pressable>

      <Pressable onPress={onRecheck} disabled={busy} hitSlop={8}>
        <Text style={[styles.link, { color: colors.mutedForeground }]}>Check again</Text>
      </Pressable>

      {busy && <ActivityIndicator color={colors.mutedForeground} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 28 },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 19, fontWeight: "600", textAlign: "center", letterSpacing: -0.2 },
  body: { fontSize: 15, textAlign: "center", maxWidth: 320, lineHeight: 21 },
  email: { fontWeight: "600" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 6,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "600" },
  link: { fontSize: 15, textAlign: "center" },
});
