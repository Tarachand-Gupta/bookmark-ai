import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useSignIn, useSSO } from "@clerk/clerk-expo";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";

// Completes the SSO browser round-trip when the app regains focus.
WebBrowser.maybeCompleteAuthSession();

/** Sign-in gate: Google (browser SSO) or an emailed one-time code — the two
 * flows every Clerk dev instance supports. Mirrors the web app's session, so
 * the same account works across web, extension, and mobile. */
export function SignInScreen() {
  const { colors, radius } = useAppTheme();
  const { startSSOFlow } = useSSO();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const failed = (err: unknown) => {
    const message =
      (err as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]
        ?.longMessage ??
      (err as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
      (err instanceof Error ? err.message : "Something went wrong. Try again.");
    setError(message);
    setBusy(false);
  };

  const signInWithGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const { createdSessionId, setActive: activate } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && activate) {
        await activate({ session: createdSessionId });
      } else {
        setBusy(false); // user closed the browser / extra steps required
      }
    } catch (err) {
      failed(err);
    }
  };

  const sendCode = async () => {
    if (!isLoaded || !email.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.create({ identifier: email.trim() });
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!factor || !("emailAddressId" in factor)) {
        setError("This account has no email-code sign-in. Use Google instead.");
        setBusy(false);
        return;
      }
      await attempt.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId,
      });
      setPhase("code");
      setBusy(false);
    } catch (err) {
      failed(err);
    }
  };

  const verifyCode = async () => {
    if (!isLoaded || code.trim().length < 4) return;
    setError(null);
    setBusy(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: code.trim(),
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Additional verification required — finish signing in on the web app.");
        setBusy(false);
      }
    } catch (err) {
      failed(err);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Symbol name="bookmark.fill" size={30} color={colors.primaryForeground} fallback="B" />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Bookmark AI</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Sign in to browse and search your library.
        </Text>
      </View>

      <View style={styles.form}>
        <Pressable
          onPress={() => void signInWithGoogle()}
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
          <Symbol name="globe" size={17} color={colors.primaryForeground} fallback="G" />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            Continue with Google
          </Text>
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>or use email</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        </View>

        {phase === "email" ? (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              editable={!busy}
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            />
            <Pressable
              onPress={() => void sendCode()}
              disabled={busy || !email.trim()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                  backgroundColor: colors.card,
                  opacity: busy || !email.trim() ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                Email me a code
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 15, color: colors.mutedForeground, textAlign: "center" }}>
              Enter the code sent to {email.trim()}
            </Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              editable={!busy}
              style={[
                styles.input,
                styles.codeInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            />
            <Pressable
              onPress={() => void verifyCode()}
              disabled={busy || code.trim().length < 4}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radius.lg,
                  opacity: busy || code.trim().length < 4 ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Verify
              </Text>
            </Pressable>
            <Pressable onPress={() => (setPhase("email"), setCode(""), setError(null))} hitSlop={8}>
              <Text style={{ fontSize: 15, color: colors.mutedForeground, textAlign: "center" }}>
                Use a different email
              </Text>
            </Pressable>
          </>
        )}

        {busy && <ActivityIndicator color={colors.mutedForeground} />}
        {error && (
          <Text style={[styles.error, { color: colors.destructive }]} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 28, gap: 32 },
  hero: { alignItems: "center", gap: 8 },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.4 },
  subtitle: { fontSize: 15, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  form: { gap: 14 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "600" },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: { fontSize: 17, fontWeight: "500" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  input: {
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  codeInput: { textAlign: "center", fontSize: 22, letterSpacing: 6 },
  error: { fontSize: 14, textAlign: "center", lineHeight: 19 },
});
