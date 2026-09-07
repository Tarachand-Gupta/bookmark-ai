import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSignIn, useSignUp, useSSO } from "@clerk/clerk-expo";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useFinishPendingSession } from "../hooks/useFinishPendingSession";
import { SSO_REDIRECT_URL } from "../lib/clerk";
import { openWebPage, PRIVACY_URL, TERMS_URL } from "../lib/links";

// Completes the SSO browser round-trip when the app regains focus.
WebBrowser.maybeCompleteAuthSession();

/**
 * Which sign-in methods this build offers — kept in lockstep with what the
 * TARGET Clerk instance (and therefore the web app) actually exposes:
 *
 *  - PROD (bookmark-ai.cloud, pk_live): email + password, email one-time code,
 *    forgot-password, AND Google OAuth — verified against the instance's FAPI
 *    /environment (oauth_google enabled + authenticatable as of 2026-08-10),
 *    with the native redirect URLs (bookmarkai:// and bookmarkai://sso-callback)
 *    registered on the prod instance's /v1/redirect_urls allowlist.
 *  - LOCAL/dev (*.accounts.dev, pk_test): same set via the dev instance.
 *
 * If a target instance ever drops its Google connection, gate this back off for
 * that target — an unbacked button dead-ends in the OAuth browser sheet.
 */
const OAUTH_ENABLED = true;

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
  // Finishes an OAuth sign-in that Clerk completed server-side but hasn't
  // handed back yet — the app must never sit there looking dead while a session
  // it already owns waits behind a retrying request.
  const finish = useFinishPendingSession();

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
  // Replaces the code phase's default "Enter the code sent to …" line when we
  // landed there as a FALLBACK the user didn't ask for (a correct password that
  // Clerk still wants an email code behind) — otherwise the screen looks like
  // it ignored the password.
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    setMode("signIn");
    activeSignIn.current = null;
    activeSignUp.current = null;
  };

  const signInWithGoogle = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    // The session Clerk creates during the OAuth round trip is only handed back
    // to us when startSSOFlow resolves — which can be 20s+ AFTER the sheet
    // closes (see useFinishPendingSession for the measured reason). Arm the
    // watcher first so the app can finish the sign-in on its own the moment
    // Clerk's client knows about that session, whatever this promise does.
    finish.arm();
    // Independently: once the app is foregrounded again, give the flow a short
    // grace period, then re-enable the form; a late resolution stays useful (a
    // real session still activates) but must no longer surface cancel-noise.
    let abandoned = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      graceTimer = setTimeout(() => {
        abandoned = true;
        setBusy(false);
      }, 2500);
      sub.remove();
    });
    const settle = () => {
      sub.remove();
      if (graceTimer) clearTimeout(graceTimer);
    };
    try {
      const {
        createdSessionId,
        setActive: activate,
        signIn: ssoSignIn,
        signUp: ssoSignUp,
        authSessionResult,
      } = await startSSOFlow({
        strategy: "oauth_google",
        // A build-time CONSTANT, never a runtime-derived URL: it has to match a
        // Clerk native redirect_urls entry byte for byte in dev runs AND release
        // builds. See SSO_REDIRECT_URL for what `makeRedirectUri()` does instead.
        redirectUrl: SSO_REDIRECT_URL,
      });
      settle();

      // Happy path: Clerk minted a session directly.
      if (createdSessionId && activate) {
        finish.disarm();
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

      // The user closed the browser sheet. Cancelling is a choice, not a
      // failure: say NOTHING rather than flashing a raw status at them.
      //   * `authSessionResult` is the AUTHORITATIVE signal — expo-web-browser
      //     reports "cancel" (swiped/× the sheet) or "dismiss" (closed by the
      //     app/OS) and Clerk passes it straight through.
      //   * the resource shapes are the fallback for the case where the flow
      //     never got as far as opening a browser: no resources at all, or a
      //     signIn still in its initial `needs_identifier` state. NOTE that an
      //     untouched flow reports verification status "unverified", NOT
      //     null/undefined (QA-reproduced on device) — treat both as "no
      //     signal"; only a verification past unverified counts as progress.
      //
      //     That fallback MUST stay gated on the sheet never having run, because
      //     a fully SUCCESSFUL round trip is indistinguishable from an untouched
      //     one by resource shape alone. clerk-expo 2.19.31's useSSO does
      //     `signIn.create({ strategy, redirectUrl })` (leaving the resource at
      //     `needs_identifier` / `unverified`) and only advances it via
      //     `signIn.reload({ rotatingTokenNonce })` after the callback — and that
      //     reload is exactly the call clerk-js resolves as a silent no-op when
      //     it decides it is offline (`_baseFetch` → null, no throw), which is
      //     the norm right as the auth sheet tears the app's sockets down. The
      //     resources then come back byte-identical to "never started" with a
      //     null createdSessionId, on a sign-in Clerk already completed
      //     server-side. Treating that as a cancel disarmed the very watcher
      //     built to recover it, and dropped the user back on this form in
      //     silence — no session, no spinner, no error. See
      //     useFinishPendingSession for the measured clerk-js behaviour.
      const untouched = (s: string | null | undefined) => s == null || s === "unverified";
      // `authSessionResult` is non-null whenever openAuthSessionAsync actually
      // resolved; sawExternalFlow() covers the app having left and come back.
      const sheetRan = authSessionResult != null || finish.sawExternalFlow();
      const cancelled =
        authSessionResult?.type === "cancel" ||
        authSessionResult?.type === "dismiss" ||
        (!sheetRan &&
          (!ssoSignIn || ssoSignIn.status === "needs_identifier") &&
          untouched(ssoSignIn?.firstFactorVerification.status) &&
          untouched(ssoSignUp?.verifications.externalAccount.status));
      if (cancelled) {
        finish.disarm();
        setBusy(false);
        return;
      }
      // Nothing usable came back. If the browser sheet actually ran, this is
      // very likely the case documented in useFinishPendingSession — the
      // session exists server-side and `reload()` returned null (or is still
      // grinding through clerk-js's retry ladder). Leave the watcher armed and
      // let it finish the job rather than telling the user it failed.
      console.warn(
        `[sso] unresolved: signIn=${ssoSignIn?.status ?? "-"} signUp=${ssoSignUp?.status ?? "-"}` +
          ` sheetRan=${finish.sawExternalFlow()}`,
      );
      if (finish.sawExternalFlow()) return;
      // The flow never left the app, so there is no session to wait for: a real
      // failure, and it must not be silent. (Unless the user already moved on —
      // a late resolution must not shout about a flow they abandoned.)
      finish.disarm();
      if (!abandoned) {
        setError(
          `Google sign-in didn't finish (${ssoSignIn?.status ?? ssoSignUp?.status ?? "unknown"}). ` +
            "Try again, or use your email and password above.",
        );
      }
      setBusy(false);
    } catch (err) {
      settle();
      // Same reasoning as above: a throw AFTER the sheet ran can still be a
      // recoverable session (that is exactly what a null `reload()` looks like
      // one frame later), so the watcher keeps its budget. Only log it.
      if (finish.sawExternalFlow()) {
        console.warn("[sso] threw after the sheet ran; watcher still finishing:", err);
        return;
      }
      finish.disarm();
      if (abandoned) {
        console.warn("[sso] late failure after user abandoned the flow:", err);
        setBusy(false);
        return;
      }
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
    setNotice(null);
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
      // The password was right but Clerk still wants a first factor (instances
      // can require email verification on top of the password). Don't dead-end
      // the user on the web app — if email_code is one of the offered
      // strategies, send it and collect it right here.
      const emailFactor = res.supportedFirstFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (res.status === "needs_first_factor" && emailFactor && "emailAddressId" in emailFactor) {
        const prepared = await res.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
        activeSignIn.current = prepared;
        setMode("signIn");
        setPhase("code");
        setNotice(`We emailed you a code to finish signing in — sent to ${identifier}`);
        setBusy(false);
        return;
      }
      // Genuinely unsupported here (real 2FA, an unknown factor): unchanged.
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
    setNotice(null);
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
    setNotice(null);
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

  /** The app is back from the OAuth sheet with a sign-in still being completed
   * behind the scenes. Takes over the form: a half-disabled set of buttons over
   * an invisible in-flight sign-in is exactly what "looks dead" means. */
  const finishing = finish.phase === "finishing";

  // The watcher spent its whole budget on a flow that demonstrably ran, so this
  // is a genuine failure and gets a real message (a cancel never lands here —
  // it leaves no evidence and resolves as `idle`).
  useEffect(() => {
    if (finish.phase !== "failed") return;
    setBusy(false);
    setError(
      "We couldn't finish signing you in — the connection dropped at the last step. " +
        "Tap Continue with Google again, or use your email and password.",
    );
  }, [finish.phase]);

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
                Google is done — we're waiting on the last handshake with the server.
              </Text>
            </View>
          ) : phase === "credentials" ? (
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
            policy). Every path on this screen — Google, password, email code —
            can create the account, so it sits under the whole form, on the
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
