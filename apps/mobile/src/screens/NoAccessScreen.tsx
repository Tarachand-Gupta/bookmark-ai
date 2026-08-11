import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useClerk, useUser } from "@clerk/clerk-expo";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";

/**
 * NO-ACCESS SCREEN — the mobile twin of the web's NoAccessNotice
 * (apps/web/components/no-access-notice.tsx). Shown when the API answers 403
 * `{code:"forbidden"}`: the Clerk session is perfectly valid, the account just
 * isn't on the API's allowlist (`CLERK_ALLOWED_USER_IDS`).
 *
 * The whole point is what it does NOT say. This is not a network failure and not
 * a "check that you're signed in" problem — the user IS signed in, just as the
 * wrong identity (the owner hit exactly this when Google's account picker chose
 * the wrong account). So: name the signed-in email, say plainly that it has no
 * access, and give the one action that can fix it — sign out and come back as
 * someone else. "Check again" is there for the case where access was just
 * granted server-side and the user shouldn't have to force-quit the app.
 */
export function NoAccessScreen({ onRecheck }: { onRecheck: () => void }) {
  const { colors, radius } = useAppTheme();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;

  const handleSignOut = () => {
    setBusy(true);
    // A throw here would only mean Clerk couldn't reach its API; the local
    // session is dropped either way, so the gate returns to the sign-in screen.
    void signOut().catch(() => undefined);
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
