import { useEffect, useRef, useState } from "react";
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
import { useSignIn, useSignUp, useSSO } from "@clerk/clerk-expo";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";

// Completes the SSO browser round-trip when the app regains focus.
WebBrowser.maybeCompleteAuthSession();

/** Clerk's code for "no account with this identifier" — the API message is the
 * bare "Couldn't find your account.", which is a dead end on its own. */
const isIdentifierNotFound = (err: unknown): boolean =>
  (err as { errors?: { code?: string }[] })?.errors?.some(
    (e) => e.code === "form_identifier_not_found",
  ) ?? false;

/** Auth gate: Google (browser SSO) or an emailed one-time code. Both flows sign
 * you IN if the account exists and sign you UP if it doesn't — a new email gets
 * an account from the same code, matching Google (which signs up on first use)
 * and the web app's /sign-up. Mirrors the web app's session, so the same account
 * works across web, extension, and mobile. */
export function SignInScreen() {
  const { colors, radius } = useAppTheme();
  const { startSSOFlow } = useSSO();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();

  // Android: pre-warm the custom tab so the SSO browser opens instantly
  // and reliably (Clerk's recommendation for Expo on Android).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"email" | "code">("email");
  // Which object the emailed code belongs to — decided when we send it.
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clerk resource methods (create/prepare/attempt) each return the UPDATED
  // resource; the useSignIn()/useSignUp() hook objects can be a stale copy
  // mid-flow (a fresh signUp.create() leaves the hook's `signUp` pointing at
  // the previous, empty attempt → "No sign up attempt was found"). Hold the
  // resource returned by the send step and run verify against THAT, never the
  // hook object. Refs (not state) so a re-render between phases can't reset it.
  const activeSignIn = useRef<NonNullable<typeof signIn> | null>(null);
  const activeSignUp = useRef<NonNullable<typeof signUp> | null>(null);

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
      const {
        createdSessionId,
        setActive: activate,
        signIn: ssoSignIn,
        signUp: ssoSignUp,
      } = await startSSOFlow({
        strategy: "oauth_google",
        // Explicit path so the URL is deterministic — it must exactly match
        // an entry in the Clerk instance's native redirect_urls allowlist.
        redirectUrl: AuthSession.makeRedirectUri({ path: "sso-callback" }),
      });

      // Happy path: Clerk minted a session directly.
      if (createdSessionId && activate) {
        await activate({ session: createdSessionId });
        return;
      }

      // Google verified fine but Clerk stopped in a "transferable" state —
      // the account exists but the attempt arrived on the other object
      // (sign-up vs sign-in). Finish it on the right one.
      if (activate && ssoSignUp?.verifications.externalAccount.status === "transferable") {
        const res = await ssoSignIn?.create({ transfer: true });
        if (res?.status === "complete" && res.createdSessionId) {
          await activate({ session: res.createdSessionId });
          return;
        }
      }
      if (activate && ssoSignIn?.firstFactorVerification.status === "transferable") {
        const res = await ssoSignUp?.create({ transfer: true });
        if (res?.status === "complete" && res.createdSessionId) {
          await activate({ session: res.createdSessionId });
          return;
        }
      }
      // First Google sign-in creates the account; when nothing is actually
      // missing, one empty update completes it.
      if (
        activate &&
        ssoSignUp?.status === "missing_requirements" &&
        ssoSignUp.missingFields.length === 0
      ) {
        const res = await ssoSignUp.update({});
        if (res.status === "complete" && res.createdSessionId) {
          await activate({ session: res.createdSessionId });
          return;
        }
      }

      // User closed the browser: no states to report, just stop quietly.
      if (!ssoSignIn && !ssoSignUp) {
        setBusy(false);
        return;
      }
      // Anything else: never fail silently — name the states.
      console.warn(
        `[sso] unresolved: signIn=${ssoSignIn?.status ?? "-"} signUp=${ssoSignUp?.status ?? "-"}`,
      );
      setError(
        `Google sign-in didn't finish (${ssoSignIn?.status ?? ssoSignUp?.status ?? "unknown"}). ` +
          "Try again, or use the email code below.",
      );
      setBusy(false);
    } catch (err) {
      failed(err);
    }
  };

  /** Email the one-time code. Existing account → sign-in code; brand-new email →
   * create the account and send its verification code, so the email path is never
   * a dead end ("Couldn't find your account.") the way a bare sign-in attempt is. */
  const sendCode = async () => {
    if (!isLoaded || !signUpLoaded || !email.trim()) return;
    setError(null);
    setBusy(true);
    // Fresh send: drop any resource held from a previous email/attempt.
    activeSignIn.current = null;
    activeSignUp.current = null;
    const identifier = email.trim();
    try {
      const attempt = await signIn.create({ identifier });
      activeSignIn.current = attempt;
      // Defensive: same class of early-completion guard as the sign-up branch.
      // A bare identifier sign-in shouldn't complete here, but if the instance
      // ever mints a session at create() there's no first factor to prepare.
      if (attempt.status === "complete" && attempt.createdSessionId) {
        await setActive({ session: attempt.createdSessionId });
        return;
      }
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!factor || !("emailAddressId" in factor)) {
        setError("This account has no email-code sign-in. Use Google instead.");
        setBusy(false);
        return;
      }
      // prepareFirstFactor returns the advanced resource — keep THAT for verify.
      const prepared = await attempt.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId,
      });
      activeSignIn.current = prepared;
      setMode("signIn");
      setPhase("code");
      setBusy(false);
    } catch (err) {
      if (!isIdentifierNotFound(err)) return failed(err);
      // No account on this email yet — sign them up with the same emailed code.
      try {
        // Use the resource RETURNED by create()/prepare(), not the hook's
        // signUp (which is still the stale pre-create attempt here).
        const created = await signUp.create({ emailAddress: identifier });
        activeSignUp.current = created;
        // Dev Clerk instances disable email verification (test emails
        // auto-verify), so create() can return "complete" with a session
        // already minted — there's nothing to verify. Activate and skip the
        // code phase; calling prepareEmailAddressVerification() on a completed
        // sign-up throws "No sign up attempt was found." On PRODUCTION (email
        // verification required) create() is "missing_requirements" and we
        // fall through to the code phase below.
        if (created.status === "complete" && created.createdSessionId) {
          await setActive({ session: created.createdSessionId });
          return;
        }
        const prepared = await created.prepareEmailAddressVerification({ strategy: "email_code" });
        activeSignUp.current = prepared;
        setMode("signUp");
        setPhase("code");
        setBusy(false);
      } catch (signUpErr) {
        failed(signUpErr);
      }
    }
  };

  const verifyCode = async () => {
    if (!isLoaded || !signUpLoaded || code.trim().length < 4) return;
    setError(null);
    setBusy(true);
    const value = code.trim();
    try {
      // Attempt on the resource sendCode() prepared — NOT the hook object,
      // which may be a stale copy of the attempt (esp. the sign-up branch).
      // Fall back to the hook object only if the ref was somehow lost.
      const signInRes = activeSignIn.current ?? signIn;
      const signUpRes = activeSignUp.current ?? signUp;
      const result =
        mode === "signUp"
          ? await signUpRes.attemptEmailAddressVerification({ code: value })
          : await signInRes.attemptFirstFactor({ strategy: "email_code", code: value });

      // Keep the ref pointing at the freshest resource for a possible retry.
      if (mode === "signUp") activeSignUp.current = result as NonNullable<typeof signUp>;
      else activeSignIn.current = result as NonNullable<typeof signIn>;

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
      } else {
        setError(
          mode === "signUp"
            ? "Couldn't finish creating your account — finish signing up on the web app."
            : "Additional verification required — finish signing in on the web app.",
        );
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
              {mode === "signUp"
                ? `Creating your account — enter the code sent to ${email.trim()}`
                : `Enter the code sent to ${email.trim()}`}
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
            <Pressable
              onPress={() => {
                setPhase("email");
                setCode("");
                setError(null);
                setMode("signIn");
                activeSignIn.current = null;
                activeSignUp.current = null;
              }}
              hitSlop={8}
            >
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
