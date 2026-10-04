import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { appleButtonStyle, describeAppleSignInError, offersAppleSignIn } from "../lib/appleSignIn";
import { beginNativeFlow, signInWithApple as nativeApple, signInWithGoogle as browserGoogle, supabase, useAuth } from "../lib/auth";
import { openWebPage, PRIVACY_URL, TERMS_URL } from "../lib/links";

const OAUTH_ENABLED = true;
const AUTH_BUTTON_HEIGHT = 50;
type Mode = "signIn" | "signUp" | "reset";

export function SignInScreen() {
  const { colors, radius, dark } = useAppTheme();
  const { finishRecovery } = useAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (offersAppleSignIn(Platform.OS)) void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => undefined);
    if (Platform.OS === "android") void WebBrowser.warmUpAsync().catch(() => undefined);
    return () => { if (Platform.OS === "android") void WebBrowser.coolDownAsync().catch(() => undefined); };
  }, []);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState(""), [newPassword, setNewPassword] = useState("");
  const [phase, setPhase] = useState<"credentials" | "code">("credentials");
  const [mode, setMode] = useState<Mode>("signIn");
  const [busy, setBusy] = useState(false), [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : "Couldn't complete sign-in. Check your connection and retry.");
  const resetToCredentials = () => { setPhase("credentials"); setCode(""); setNewPassword(""); setError(null); setNotice(null); setMode("signIn"); };
  const signInWithGoogle = async () => {
    setError(null); setBusy(true); setFinishing(true);
    try { await browserGoogle(); } catch (failure) { failed(failure); }
    finally { setBusy(false); setFinishing(false); }
  };
  const signInWithApple = async () => {
    setError(null); setBusy(true);
    try { await nativeApple(); }
    catch (failure) { const message = describeAppleSignInError(failure); if (message.kind !== "cancelled") setError(message.message); }
    finally { setBusy(false); }
  };
  const continueWithPassword = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "signUp") {
        const redirect = await beginNativeFlow("signup");
        const { data, error: failure } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect } });
        if (failure) throw failure;
        if (!data.session) { setPhase("code"); setNotice("Check your email for the confirmation link. If it includes a code, enter it here."); }
      } else {
        const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (failure) throw failure;
      }
    } catch (failure) { failed(failure); }
    finally { setBusy(false); }
  };
  const sendEmailCode = async () => {
    setBusy(true); setError(null);
    try {
      const redirect = await beginNativeFlow("signup");
      const { error: failure } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect, shouldCreateUser: true } });
      if (failure) throw failure;
      setMode("signIn"); setPhase("code"); setNotice("Check your email for the sign-in link. If it includes a code, enter it here.");
    } catch (failure) { failed(failure); }
    finally { setBusy(false); }
  };
  const forgotPassword = async () => {
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setBusy(true); setError(null);
    try {
      const redirect = await beginNativeFlow("recovery");
      const { error: failure } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
      if (failure) throw failure;
      setMode("reset"); setPhase("code"); setNotice("Open your recovery email link, or enter its code and choose a new password.");
    } catch (failure) { failed(failure); }
    finally { setBusy(false); }
  };
  const verifyCode = async () => {
    setBusy(true); setError(null);
    try {
      const { error: failure } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: mode === "reset" ? "recovery" : mode === "signUp" ? "signup" : "email" });
      if (failure) throw failure;
      if (mode === "reset") {
        const { error: updateFailure } = await supabase.auth.updateUser({ password: newPassword });
        if (updateFailure) throw updateFailure;
        setNewPassword(""); finishRecovery();
      }
    } catch (failure) { failed(failure); }
    finally { setBusy(false); }
  };
  const verifyDisabled = busy || code.trim().length < 6 || (mode === "reset" && newPassword.length < 8);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[styles.root, { backgroundColor: colors.background }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, styles.column]}>
          <View style={[styles.mark, { backgroundColor: colors.primary }]}>
            <Symbol name="bookmark.fill" size={30} color={colors.primaryForeground} fallback="B" />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Bookmark AI</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Sign in to browse and search your library.
          </Text>
        </View>

        <View style={[styles.form, styles.column]}>
          {finishing ? (
            <View style={styles.finishing} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.mutedForeground} />
              <Text style={[styles.finishingTitle, { color: colors.foreground }]}>
                Finishing sign-in…
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Complete sign-in in the browser. You can return here if you cancel.
              </Text>
            </View>
          ) : phase === "credentials" ? (
            <>
              {OAUTH_ENABLED && (
                <>
                  {appleAvailable && (
                    // Apple's own ASAuthorizationAppleIDButton — Apple-approved
                    // title, logo, colours and localisation for free. It has no
                    // disabled state of its own, so gate touches and dim it
                    // while a flow runs, exactly like the Google button. Above
                    // Google on purpose: it must never read as the lesser option.
                    <View
                      pointerEvents={busy ? "none" : "auto"}
                      accessibilityState={{ disabled: busy }}
                      style={{ opacity: busy ? 0.6 : 1 }}
                    >
                      <AppleAuthentication.AppleAuthenticationButton
                        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                        buttonStyle={
                          AppleAuthentication.AppleAuthenticationButtonStyle[appleButtonStyle(dark)]
                        }
                        cornerRadius={radius.lg}
                        onPress={() => void signInWithApple()}
                        style={styles.appleBtn}
                      />
                    </View>
                  )}

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
                  {mode === "signUp" ? "Create account" : "Sign in"}
                </Text>
              </Pressable>

              <Pressable onPress={() => { setMode(mode === "signUp" ? "signIn" : "signUp"); setError(null); }} disabled={busy} hitSlop={8}>
                <Text style={[styles.linkText, { color: colors.foreground }]}>{mode === "signUp" ? "Already have an account? Sign in" : "New here? Create an account"}</Text>
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
                {notice ??
                  (mode === "signUp"
                    ? `Creating your account — enter the code sent to ${email.trim()}`
                    : mode === "reset"
                      ? `Enter the code sent to ${email.trim()} and choose a new password`
                      : `Enter the code sent to ${email.trim()}`)}
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
                  // letterSpacing/large type deform the placeholder — only track a real value
                  code.length === 0 && styles.codeInputEmpty,
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

          {/* The finishing panel has its own spinner — one is enough. */}
          {busy && !finishing && <ActivityIndicator color={colors.mutedForeground} />}
          {error && (
            <Text style={[styles.error, { color: colors.destructive }]} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>

        {/* Consent line — the disclosure both stores expect at the point an
            account is created (App Store 5.1.1(i)/5.1.2(i): personal data and
            saved links go to the server and to third-party AI; Play User Data
            policy). Every path on this screen — Apple, Google, password, email
            code — can create the account, so it sits under the whole form, on the
            credentials step only (the code step is mid-flow). */}
        {phase === "credentials" && !finishing && (
          <Text style={[styles.consent, styles.column, { color: colors.mutedForeground }]}>
            By continuing you agree to the{" "}
            <Text
              onPress={() => openWebPage(TERMS_URL)}
              accessibilityRole="link"
              style={[styles.consentLink, { color: colors.foreground }]}
            >
              Terms of Service
            </Text>{" "}
            and{" "}
            <Text
              onPress={() => openWebPage(PRIVACY_URL)}
              accessibilityRole="link"
              style={[styles.consentLink, { color: colors.foreground }]}
            >
              Privacy Policy
            </Text>
            .
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // `alignItems: "center"` + the children's maxWidth is the iPad story: on a
  // 13" iPad the form would otherwise stretch edge to edge (1,000+ pt wide
  // inputs and a button as wide as the screen). Phones are narrower than the cap,
  // so nothing changes there.
  root: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 32 },
  column: { width: "100%", maxWidth: 440 },
  hero: { alignItems: "center", gap: 8 },
  finishing: { alignItems: "center", gap: 12, paddingVertical: 24 },
  finishingTitle: { fontSize: 17, fontWeight: "600" },
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
  // The system Apple button needs an explicit width and height (it renders
  // nothing without them) and refuses backgroundColor/borderRadius via style —
  // its colour comes from buttonStyle, its radius from cornerRadius.
  appleBtn: { width: "100%", height: AUTH_BUTTON_HEIGHT },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: AUTH_BUTTON_HEIGHT,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "600" },
  secondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: AUTH_BUTTON_HEIGHT,
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
    // Explicit, not a default: iOS leaks codeInput's tracking into any
    // TextInput that doesn't declare its own (see codeInput below).
    letterSpacing: 0,
  },
  codeInput: { textAlign: "center", fontSize: 22, letterSpacing: 6 },
  codeInputEmpty: { fontSize: 17, letterSpacing: 0 },
  error: { fontSize: 14, textAlign: "center", lineHeight: 19 },
  // Pulled up against the form (the root's gap is sized for hero → form) and
  // kept clear of the home indicator by the SafeAreaView around this screen.
  consent: { fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: -12 },
  consentLink: { fontWeight: "600", textDecorationLine: "underline" },
});
