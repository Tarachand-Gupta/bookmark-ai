import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { appleButtonStyle, appleSignInPresentation, offersAppleSignIn } from "../lib/appleSignIn";
import { adoptNativeEmailSession, createNativeEmailAuthClient, signInInBrowser } from "../lib/auth";
import { createEmailAuthFlow, validEmailCode, type EmailMode, type EmailStep } from "../lib/email-auth-flow";
import { getApiUrl } from "../api";
import { openWebPage, PRIVACY_URL, TERMS_URL } from "../lib/links";

const OAUTH_ENABLED = true;

export function SignInScreen() {
  const { colors, radius, dark } = useAppTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [phase, setPhase] = useState<"credentials" | "code">("credentials");
  const [mode, setMode] = useState<EmailMode>("signIn");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const appleAvailable = OAUTH_ENABLED && offersAppleSignIn(Platform.OS);
  const applePresentation = appleSignInPresentation(Platform.OS);
  const finishing = false;
  const flow = useRef<ReturnType<typeof createEmailAuthFlow> | null>(null);
  if (!flow.current) flow.current = createEmailAuthFlow(createNativeEmailAuthClient(), `${getApiUrl()}/auth/callback?next=/sign-in`, adoptNativeEmailSession);
  useEffect(() => () => flow.current?.dispose(), []);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);
  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : "Couldn't finish sign-in. Check your connection and try again.");
  };
  const step = (result: EmailStep) => {
    if (result.phase === "code") { setMode(result.mode); setPhase("code"); setNotice(result.notice ?? null); }
  };
  const run = async (work: () => Promise<EmailStep | void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null); setNotice(null);
    try { const result = await work(); if (result) step(result); }
    catch (failure) { failed(failure); }
    finally { running.current = false; setBusy(false); }
  };
  const resetToCredentials = () => {
    if (running.current) return;
    void flow.current!.reset().catch(failed);
    setPhase("credentials"); setMode("signIn"); setCode(""); setNewPassword(""); setNotice(null); setError(null);
  };
  const continueWithPassword = () => run(async () => {
    if (!email.trim() || !password) return;
    setCode(""); setNewPassword(""); return flow.current!.password(email, password);
  });
  const sendEmailCode = () => run(async () => {
    if (!email.trim()) return;
    setCode(""); setNewPassword(""); return flow.current!.code(email);
  });
  const forgotPassword = () => {
    if (!email.trim()) { setError("Enter your email first, then tap Forgot password."); return Promise.resolve(); }
    return run(async () => { setCode(""); setNewPassword(""); return flow.current!.recovery(email); });
  };
  const verifyCode = () => run(() => flow.current!.verify(email, mode, code, newPassword));
  // Original social buttons use the separately scoped hosted provider session.
  const signInWithGoogle = () => run(() => signInInBrowser("google"));
  const signInWithApple = () => run(() => signInInBrowser("apple"));
  const codeTooShort = !validEmailCode(code);
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
        <View style={[styles.hero, styles.column]}>
          <View style={[styles.mark, { backgroundColor: colors.primary, borderRadius: radius.lg }]}>
            <Symbol name="bookmark.fill" size={20} color={colors.primaryForeground} fallback="B" />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Bookmark AI</Text>
        </View>

        <View style={[styles.form, styles.column, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.xl }]}>
          <View style={styles.formHeading}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>{phase === "credentials" ? "Welcome back" : mode === "reset" ? "Reset your password" : "Check your email"}</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{phase === "credentials" ? "Sign in to browse and search your library." : "Complete verification to continue."}</Text>
          </View>
          {finishing ? (
            <View style={styles.finishing} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.mutedForeground} />
              <Text style={[styles.finishingTitle, { color: colors.foreground }]}>
                Finishing sign-in…
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Google is done — we're waiting on the last handshake with the server.
              </Text>
            </View>
          ) : phase === "credentials" ? (
            <>
              {OAUTH_ENABLED && (
                <>
                  {appleAvailable && (applePresentation === "native" ? (
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
                  ) : (
                    <Pressable
                      onPress={() => void signInWithApple()}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Continue with Apple"
                      accessibilityState={{ disabled: busy }}
                      style={({ pressed }) => [styles.primaryBtn, {
                        backgroundColor: dark ? "#ffffff" : "#000000",
                        borderRadius: radius.lg,
                        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                      }]}
                    >
                      <Ionicons name="logo-apple" size={20} color={dark ? "#000000" : "#ffffff"} />
                      <Text style={[styles.primaryBtnText, { color: dark ? "#000000" : "#ffffff" }]}>Continue with Apple</Text>
                    </Pressable>
                  ))}

                  <Pressable
                    onPress={() => void signInWithGoogle()}
                    disabled={busy}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderRadius: radius.lg,
                        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="logo-google" size={18} color={colors.foreground} />
                    <Text style={[styles.primaryBtnText, { color: colors.foreground }]}>
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

              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                accessibilityLabel="Email"
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
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                accessibilityLabel="Password"
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
                {notice ??
                  (mode === "signUp"
                    ? `Check your email — enter the code sent to ${email.trim()}`
                    : mode === "reset"
                      ? `Enter the code sent to ${email.trim()} and choose a new password`
                      : `Enter the code sent to ${email.trim()}`)}
              </Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="12345678"
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

const AUTH_BUTTON_HEIGHT = 50;
const styles = StyleSheet.create({
  flex: { flex: 1 },
  // `alignItems: "center"` + the children's maxWidth is the iPad story: on a
  // 13" iPad the form would otherwise stretch edge to edge (1,000+ pt wide
  // inputs and a button as wide as the screen). Phones are narrower than the cap,
  // so nothing changes there.
  root: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 24 },
  column: { width: "100%", maxWidth: 400 },
  hero: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  finishing: { alignItems: "center", gap: 12, paddingVertical: 24 },
  finishingTitle: { fontSize: 17, fontWeight: "600" },
  mark: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  subtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  form: { gap: 12, padding: 20, borderWidth: StyleSheet.hairlineWidth },
  formHeading: { alignItems: "center", gap: 6, marginBottom: 8 },
  formTitle: { fontSize: 24, fontWeight: "600", letterSpacing: -0.5 },
  fieldLabel: { fontSize: 14, fontWeight: "500", marginBottom: -6 },
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
