import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useSignIn, useSignUp, useSSO } from "@clerk/clerk-expo";
import { SERVER_TARGET } from "../api";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";

// Completes the SSO browser round-trip when the app regains focus.
WebBrowser.maybeCompleteAuthSession();

/**
 * Which sign-in methods this build offers — kept in lockstep with what the
 * TARGET Clerk instance (and therefore the web app) actually exposes:
 *
 *  - PROD (bookmark-ai.cloud, pk_live): email + password, email one-time code,
 *    and forgot-password — verified against the instance's FAPI /environment
 *    (identification: email_address; first_factors: email_code, password,
 *    reset_password_email_code). The prod instance has NO social providers
 *    configured, so there is NO Google button — it would only dead-end.
 *  - LOCAL/dev (*.accounts.dev, pk_test): the dev instance additionally has
 *    Google/Apple/GitHub OAuth enabled, so we surface "Continue with Google"
 *    for convenient local testing.
 *
 * To offer Google in production the prod Clerk instance must first enable the
 * Google OAuth provider (Dashboard → SSO connections) with a GCP OAuth client,
 * and add the native redirect URL (bookmarkai://sso-callback) to its allowlist;
 * until then the web app doesn't show it either, so mobile matches by hiding it.
 */
const OAUTH_ENABLED = SERVER_TARGET === "local";

/** Clerk's code for "no account with this identifier" — the API message is the
 * bare "Couldn't find your account.", which is a dead end on its own. */
const isIdentifierNotFound = (err: unknown): boolean =>
  (err as { errors?: { code?: string }[] })?.errors?.some(
    (e) => e.code === "form_identifier_not_found",
  ) ?? false;

/** Clerk error codes that mean the in-flight signUp/signIn resource is stale —
 * expired, already verified, or gone. Re-attempting the same code against it is
 * a dead end; the only recovery is to restart the attempt from a clean resource. */
const STALE_RESOURCE_CODES = new Set([
  "verification_expired",
  "verification_already_verified",
  "verification_missing",
  "sign_up_not_found",
  "resource_not_found",
]);
const isStaleResourceError = (err: unknown): boolean =>
  (err as { errors?: { code?: string }[] })?.errors?.some(
    (e) => e.code != null && STALE_RESOURCE_CODES.has(e.code),
  ) ?? false;

type Mode = "signIn" | "signUp" | "reset";

/**
 * Auth gate mirroring the web app's Clerk sign-in so the SAME account works
 * across web, extension, and mobile (same prod Clerk instance):
 *   - Email + password — signs you IN if the account exists, and signs you UP
 *     (new email → new account, verified by an emailed code) if it doesn't.
 *   - "Email me a code instead" — passwordless sign-in via a one-time email code.
 *   - "Forgot password?" — reset the password with an emailed code.
 *   - "Continue with Google" — only on the dev target (see OAUTH_ENABLED).
 */
export function SignInScreen() {
  const { colors, radius } = useAppTheme();
  const { startSSOFlow } = useSSO();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();

  // Android: pre-warm the custom tab so the SSO browser opens instantly
  // and reliably (Clerk's recommendation for Expo on Android).
  useEffect(() => {
    if (!OAUTH_ENABLED || Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [phase, setPhase] = useState<"credentials" | "code">("credentials");
  // What the emailed code we're collecting belongs to — decided when we send it.
  const [mode, setMode] = useState<Mode>("signIn");
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

  const resetToCredentials = () => {
    setPhase("credentials");
    setCode("");
    setNewPassword("");
    setError(null);
    setMode("signIn");
    activeSignIn.current = null;
    activeSignUp.current = null;
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
          "Try again, or use your email and password below.",
      );
      setBusy(false);
    } catch (err) {
      failed(err);
    }
  };

  /** Primary method: email + password. Existing account → sign in. Unknown email
   * → create the account with this password and verify it with an emailed code,
   * so the email path is never a dead end the way a bare sign-in attempt is. */
  const continueWithPassword = async () => {
    if (!isLoaded || !signUpLoaded) return;
    const identifier = email.trim();
    if (!identifier || !password) return;
    setError(null);
    setBusy(true);
    // Start from a clean slate so a leftover code/verification from a previous
    // (failed or abandoned) attempt can't leak into this one.
    setCode("");
    setNewPassword("");
    activeSignIn.current = null;
    activeSignUp.current = null;
    try {
      const attempt = await signIn.create({ identifier, password });
      activeSignIn.current = attempt;
      if (attempt.status === "complete" && attempt.createdSessionId) {
        await setActive({ session: attempt.createdSessionId });
        return;
      }
      // create() didn't auto-complete — attempt the password factor explicitly.
      const res = await attempt.attemptFirstFactor({ strategy: "password", password });
      activeSignIn.current = res;
      if (res.status === "complete" && res.createdSessionId) {
        await setActive({ session: res.createdSessionId });
        return;
      }
      setError("Extra verification is required — finish signing in on the web app.");
      setBusy(false);
    } catch (err) {
      if (!isIdentifierNotFound(err)) return failed(err);
      // No account on this email yet — create one with this password, then
      // verify the email with a code (production requires email verification).
      try {
        const created = await signUp.create({ emailAddress: identifier, password });
        activeSignUp.current = created;
        // Dev Clerk instances may auto-verify test emails, so create() can come
        // back "complete" with a session already minted — nothing to verify.
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

  /** Alternate: passwordless sign-in with a one-time email code (for existing
   * accounts). New emails are routed to the password flow above, since creating
   * an account requires a password on the production instance. */
  const sendEmailCode = async () => {
    if (!isLoaded || !email.trim()) return;
    setError(null);
    setBusy(true);
    setCode("");
    setNewPassword("");
    activeSignIn.current = null;
    activeSignUp.current = null;
    const identifier = email.trim();
    try {
      const attempt = await signIn.create({ identifier });
      activeSignIn.current = attempt;
      if (attempt.status === "complete" && attempt.createdSessionId) {
        await setActive({ session: attempt.createdSessionId });
        return;
      }
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!factor || !("emailAddressId" in factor)) {
        setError("This account has no email-code sign-in. Use your password above.");
        setBusy(false);
        return;
      }
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
      setError("No account uses this email yet. Enter a password above and tap Continue to create one.");
      setBusy(false);
    }
  };

  /** Forgot password: email a reset code, then collect the code + a new password. */
  const forgotPassword = async () => {
    if (!isLoaded) return;
    const identifier = email.trim();
    if (!identifier) {
      setError("Enter your email first, then tap Forgot password.");
      return;
    }
    setError(null);
    setBusy(true);
    setCode("");
    setNewPassword("");
    activeSignIn.current = null;
    try {
      const attempt = await signIn.create({ identifier });
      activeSignIn.current = attempt;
      const factor = attempt.supportedFirstFactors?.find(
        (f) => f.strategy === "reset_password_email_code",
      );
      if (!factor || !("emailAddressId" in factor)) {
        setError("Password reset isn't available for this account. Try the email code option.");
        setBusy(false);
        return;
      }
      const prepared = await attempt.prepareFirstFactor({
        strategy: "reset_password_email_code",
        emailAddressId: factor.emailAddressId,
      });
      activeSignIn.current = prepared;
      setMode("reset");
      setPhase("code");
      setBusy(false);
    } catch (err) {
      if (isIdentifierNotFound(err)) {
        setError("No account uses this email yet. Enter a password above to create one.");
        setBusy(false);
        return;
      }
      failed(err);
    }
  };

  const verifyCode = async () => {
    if (!isLoaded || !signUpLoaded) return;
    if (code.trim().length < 4) return;
    if (mode === "reset" && newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setError(null);
    setBusy(true);
    const value = code.trim();
    try {
      if (mode === "signUp") {
        // Verify against the resource returned by the send step, never the
        // useSignUp() hook object — that can be a stale/empty attempt. If we
        // lost it, the flow can't be recovered here, so restart cleanly.
        const signUpRes = activeSignUp.current;
        if (!signUpRes) {
          resetToCredentials();
          setBusy(false);
          setError("Your sign-up session expired. Enter your email again to restart.");
          return;
        }
        // A prior attempt may already have verified the email (re-tapped Verify,
        // returned to the screen). Don't re-attempt — Clerk throws "already
        // verified" — just finish with the session it already minted.
        if (signUpRes.status === "complete" && signUpRes.createdSessionId) {
          await setActive({ session: signUpRes.createdSessionId });
          return;
        }
        const result = await signUpRes.attemptEmailAddressVerification({ code: value });
        activeSignUp.current = result as NonNullable<typeof signUp>;
        if (result.status === "complete" && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
        } else {
          setError("Couldn't finish creating your account — finish signing up on the web app.");
          setBusy(false);
        }
        return;
      }

      const signInRes = activeSignIn.current ?? signIn;
      if (mode === "reset") {
        const attempted = await signInRes.attemptFirstFactor({
          strategy: "reset_password_email_code",
          code: value,
        });
        activeSignIn.current = attempted as NonNullable<typeof signIn>;
        if (attempted.status === "needs_new_password") {
          const done = await attempted.resetPassword({ password: newPassword });
          activeSignIn.current = done as NonNullable<typeof signIn>;
          if (done.status === "complete" && done.createdSessionId) {
            await setActive({ session: done.createdSessionId });
            return;
          }
          setError("Couldn't reset your password — try again on the web app.");
          setBusy(false);
          return;
        }
        if (attempted.status === "complete" && attempted.createdSessionId) {
          await setActive({ session: attempted.createdSessionId });
          return;
        }
        setError("Extra verification is required — finish resetting on the web app.");
        setBusy(false);
        return;
      }

      // mode === "signIn" — email one-time code.
      const result = await signInRes.attemptFirstFactor({ strategy: "email_code", code: value });
      activeSignIn.current = result as NonNullable<typeof signIn>;
      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Extra verification is required — finish signing in on the web app.");
        setBusy(false);
      }
    } catch (err) {
      // Expired / already-verified / lost resource: the code step is a dead end
      // now, so drop back to the start (email + password kept) instead of
      // leaving a button that keeps failing on the same stale attempt.
      if (isStaleResourceError(err)) {
        resetToCredentials();
        setBusy(false);
        setError("That verification expired. Enter your email again to restart.");
        return;
      }
      failed(err);
    }
  };

  const codeTooShort = code.trim().length < 4;
  const resetPwTooShort = mode === "reset" && newPassword.length < 8;
  const verifyDisabled = busy || codeTooShort || resetPwTooShort;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[styles.root, { backgroundColor: colors.background }]}
        keyboardShouldPersistTaps="handled"
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
          {phase === "credentials" ? (
            <>
              {OAUTH_ENABLED && (
                <>
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
                    <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                      or use email
                    </Text>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  </View>
                </>
              )}

              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="username"
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
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                autoComplete="password"
                textContentType="password"
                editable={!busy}
                onSubmitEditing={() => void continueWithPassword()}
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
                onPress={() => void continueWithPassword()}
                disabled={busy || !email.trim() || !password}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.lg,
                    opacity: busy || !email.trim() || !password ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                  Continue
                </Text>
              </Pressable>

              <Pressable onPress={() => void forgotPassword()} disabled={busy} hitSlop={8}>
                <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                  Forgot password?
                </Text>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>or</Text>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              </View>

              <Pressable
                onPress={() => void sendEmailCode()}
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
                  Email me a code instead
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 15, color: colors.mutedForeground, textAlign: "center" }}>
                {mode === "signUp"
                  ? `Creating your account — enter the code sent to ${email.trim()}`
                  : mode === "reset"
                    ? `Enter the code sent to ${email.trim()} and choose a new password`
                    : `Enter the code sent to ${email.trim()}`}
              </Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
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
              {mode === "reset" && (
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="New password"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  autoComplete="password-new"
                  textContentType="newPassword"
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
              )}
              <Pressable
                onPress={() => void verifyCode()}
                disabled={verifyDisabled}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.lg,
                    opacity: verifyDisabled ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                  {mode === "reset" ? "Reset password" : "Verify"}
                </Text>
              </Pressable>
              <Pressable onPress={resetToCredentials} hitSlop={8}>
                <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 32 },
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
  linkText: { fontSize: 15, textAlign: "center" },
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
