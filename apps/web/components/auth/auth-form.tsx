"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import { getAuthFlowSupabase, nativeFlowFromLocation, nativeProviderHint, nativeMfaDestination } from "@/lib/native-auth-context";
import { authDestinationFromSearch, safeAuthDestination } from "@/lib/auth-policy";
import { passwordUpdateDestination, recoveryPage } from "@/lib/password-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldSeparator, FieldDescription } from "@/components/ui/field";
import { AuthShell } from "./auth-shell";
import { AppleIcon, GoogleIcon } from "./provider-icons";

const authLink =
  "rounded-sm font-medium text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
export function AuthForm({
  mode,
}: {
  mode: "sign-in" | "sign-up" | "recovery" | "update-password" | "mfa";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busyAction, setBusyAction] = useState<"form" | "google" | "apple" | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const busy = busyAction !== null;
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mfa = mode === "mfa";
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [emailCodePending, setEmailCodePending] = useState(false);
  const [passwordSessionReady, setPasswordSessionReady] = useState(false);
  const [nextQuery, setNextQuery] = useState("");
  const nativeProviderStarted = useRef(false);
  useEffect(() => {
    const hint = nativeProviderHint(window.location.search, window.location.pathname);
    if (mode !== "sign-in" || nativeProviderStarted.current || !hint) return;
    nativeProviderStarted.current = true;
    // Consume the hint before OAuth; reloads and error returns never restart it.
    const address = new URL(window.location.href);
    address.searchParams.delete("native_provider");
    window.history.replaceState(null, "", address.href);
    setBusyAction(hint.provider);
    void fetch("/api/auth/native/view", { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ flowId: hint.flow, browserNonce: hint.nonce }) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sign-in request ended");
        const flow = await response.json();
        if (!Number.isFinite(flow.expiresAt) || flow.expiresAt <= Date.now()) throw new Error("Sign-in request ended");
        await social(hint.provider);
      })
      .catch(() => { setBusyAction(null); setError("This sign-in request ended. Start again in the app."); });
  }, [mode]);
  useEffect(() => {
    const destination = authDestinationFromSearch(window.location.search);
    setNextQuery(`?next=${encodeURIComponent(destination)}`);
    if (mode === "recovery" && new URLSearchParams(window.location.search).get("step") === "code") setEmailCodePending(true);
  }, []);
  useEffect(() => {
    if (mfa)
      void getAuthFlowSupabase()
        .auth.mfa.listFactors()
        .then(({ data, error }) => {
          if (error) throw error;
          const verifiedFactor = data?.totp.find((f) => f.status === "verified")?.id ?? "";
          setFactor(verifiedFactor);
          if (!verifiedFactor)
            setError("We could not load your authenticator. Return to sign in and try again.");
        })
        .catch(() =>
          setError("We could not load your authenticator. Return to sign in and try again."),
        );
  }, [mfa]);
  useEffect(() => {
    if (mode !== "update-password") return;
    let active = true;
    const next = "/auth/update-password?next=" + encodeURIComponent(authDestinationFromSearch(window.location.search));
    void passwordUpdateDestination(getAuthFlowSupabase().auth, next).then((destination) => {
      if (!active) return;
      if (destination) window.location.replace(destination);
      else setPasswordSessionReady(true);
    }).catch(() => { if (active) setError("Your password reset session is unavailable. Request a new recovery code, or sign in again."); });
    return () => { active = false; };
  }, [mode]);
  async function sendRecoveryCode() {
    const next = authDestinationFromSearch(window.location.search);
    const result = await getAuthFlowSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: callback("/auth/update-password?next=" + encodeURIComponent(next)),
    });
    if (result.error) throw result.error;
    setEmailCodePending(true);
    setCode("");
    setMessage("If an account exists for this address, we’ve sent a recovery email. Enter its code here. Use the newest email and avoid opening its link in another browser.");
  }
  async function resendRecoveryCode() {
    if (busy || !email.trim()) return;
    setBusyAction("form"); setError(""); setMessage("");
    try { await sendRecoveryCode(); }
    catch { setError("We could not send another code yet. Wait a moment and try again."); }
    finally { setBusyAction(null); }
  }
  const title = {
    "sign-in": "Sign in",
    "sign-up": "Create your account",
    recovery: "Reset your password",
    "update-password": "Set a new password",
    mfa: "Verify your authenticator",
  }[mode];
  function callback(next = "/app") {
    const url = new URL("/auth/callback", window.location.origin);
    url.searchParams.set("next", safeAuthDestination(next));
    return url.href;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusyAction("form");
    if (mode === "sign-in" && !mfa && !emailCodePending) setSigningIn(true);
    setError("");
    setMessage("");
    try {
      const auth = getAuthFlowSupabase().auth;
      const next = authDestinationFromSearch(window.location.search);
      if (emailCodePending) {
        const result = await auth.verifyOtp({email,token:code,type:mode === "recovery" ? "recovery" : "signup"});
        if(result.error)throw result.error;
        if (!result.data.session) throw new Error("Verification did not establish a session.");
        const destination = mode === "recovery" ? "/auth/update-password?next=" + encodeURIComponent(next) : next;
        window.location.assign(nativeMfaDestination(await auth.mfa.getAuthenticatorAssuranceLevel(), destination) ?? destination);
      } else if (mfa) {
        const result = await auth.mfa.challengeAndVerify({ factorId: factor, code });
        if (result.error) throw result.error;
        window.location.assign(next);
      } else if (mode === "recovery") {
        await sendRecoveryCode();
      } else if (mode === "update-password") {
        const challenge = await passwordUpdateDestination(auth, "/auth/update-password?next=" + encodeURIComponent(next));
        if (challenge) { window.location.assign(challenge); return; }
        const result = await auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword("");
        setShowPassword(false);
        setMessage("Password updated. You can return to your library.");
      } else if (mode === "sign-up") {
        const result = await auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: callback(next),
            data: { display_name: name.trim().slice(0, 80) },
          },
        });
        if (result.error) throw result.error;
        if (result.data.session) window.location.assign(next);
        else if(nativeFlowFromLocation()){setEmailCodePending(true);setPassword("");setMessage("Enter the code from your confirmation email here. Keep this browser window open.");}
        else setMessage("Check your email to confirm your account, then return to sign in.");
      } else {
        const result = await auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        const assurance = await auth.mfa.getAuthenticatorAssuranceLevel();
        // AuthProvider remounts this form when identity changes. Navigate to the
        // challenge so MFA cannot be lost with state on the previous instance.
        window.location.assign(nativeMfaDestination(assurance, next) ?? next);
      }
    } catch (failure) {
      setSigningIn(false);
      const expired = typeof failure === "object" && failure !== null && "code" in failure && failure.code === "otp_expired";
      setError(mode === "recovery" && emailCodePending
        ? expired
          ? "This code is invalid, expired, or already used. If you opened the email link, request a new code and enter the newest code here without opening its link."
          : "We could not verify that code right now. Try again, or request a new code if you opened the email link elsewhere."
        : "We could not complete that request. Check your details and try again.");
    } finally {
      setBusyAction(null);
    }
  }
  async function social(provider: "google" | "apple") {
    if (busy) return;
    setBusyAction(provider);
    setError("");
    setMessage("");
    try {
      const next = authDestinationFromSearch(window.location.search);
      const { error } = await getAuthFlowSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: callback(next) },
      });
      if (error) throw error;
    } catch {
      setError("Sign-in is temporarily unavailable. Try again.");
      setBusyAction(null);
    }
  }
  const description = mfa
    ? "Enter the six-digit code from your authenticator app."
    : {
        "sign-in": "Sign in to access your bookmarks and saved sessions.",
        "sign-up": "Keep your bookmarks and saved sessions together.",
        recovery: emailCodePending ? "Enter the code from your recovery email in this window." : "Enter your email and we’ll send you a recovery email.",
        "update-password": "Choose a new password for your account.",
        mfa: "Enter the six-digit code from your authenticator app.",
      }[mode];
  const action = mfa
    ? "Verify"
    : mode === "recovery"
      ? "Send recovery email"
      : mode === "update-password"
        ? "Update password"
        : mode === "sign-up"
          ? "Create account"
          : "Sign in";
  const pendingAction = mfa
    ? "Verifying…"
    : mode === "recovery"
      ? emailCodePending ? "Verifying code…" : "Sending recovery email…"
      : mode === "update-password"
        ? "Updating password…"
        : mode === "sign-up"
          ? "Creating account…"
          : "Signing in…";
  const showProviders = !mfa && !emailCodePending && (mode === "sign-in" || mode === "sign-up");
  const passwordUpdated = mode === "update-password" && Boolean(message);
  return (
    <AuthShell
      title={mfa ? "Verify your authenticator" : mode === "sign-in" ? "Welcome back" : title}
      description={description}
      signingIn={signingIn}
    >
      {showProviders && (
        <>
          <Field className="gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={busy}
              onClick={() => void social("google")}
            >
              {busyAction === "google" ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <GoogleIcon className="size-4" />
              )}
              {busyAction === "google" ? "Connecting to Google…" : "Continue with Google"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={busy}
              onClick={() => void social("apple")}
            >
              {busyAction === "apple" ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <AppleIcon className="size-4" />
              )}
              {busyAction === "apple" ? "Connecting to Apple…" : "Continue with Apple"}
            </Button>
          </Field>
          <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">Or continue with email</FieldSeparator>
        </>
      )}
      {!passwordUpdated && (mode !== "update-password" || passwordSessionReady) && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-6"
          aria-busy={busy}
          aria-describedby={error ? "auth-error" : message ? "auth-message" : undefined}
        >
          <FieldGroup>
          {!mfa && !emailCodePending && mode === "sign-up" && (
            <Field>
              <FieldLabel htmlFor="auth-name" className="text-sm font-medium">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="auth-name"
                className="h-11"
                autoComplete="name"
                placeholder="Your name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          {!mfa && (!emailCodePending || mode === "recovery") && mode !== "update-password" && (
            <Field>
              <FieldLabel htmlFor="auth-email" className="text-sm font-medium">
                Email
              </FieldLabel>
              <Input
                id="auth-email"
                className="h-11"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); setCode(""); }}
              />
            </Field>
          )}
          {!mfa && !emailCodePending && mode !== "recovery" && (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="auth-password" className="text-sm font-medium">
                  {mode === "update-password" ? "New password" : "Password"}
                </FieldLabel>
                {mode === "sign-in" && (
                  <Link
                    href={`/auth/recovery${nextQuery}`}
                    className={`${authLink} -my-2 inline-flex min-h-11 items-center whitespace-nowrap text-xs`}
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <Input
                  id="auth-password"
                  className="h-11 pr-12"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  placeholder={mode === "sign-in" ? "Enter your password" : "Create a password"}
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={mode !== "sign-in" ? "auth-password-help" : undefined}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute inset-y-0 right-0 size-11 rounded-l-none text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </Button>
              </div>
              {mode !== "sign-in" && (
                <p id="auth-password-help" className="text-xs text-muted-foreground">
                  Use at least 8 characters.
                </p>
              )}
            </Field>
          )}
          {(mfa || emailCodePending) && (
            <Field>
              <FieldLabel htmlFor="auth-code" className="text-sm font-medium">
                {emailCodePending ? "Email code" : "Authenticator code"}
              </FieldLabel>
              <Input
                id="auth-code"
                className="h-11 text-center font-mono tracking-widest"
                placeholder={emailCodePending ? "Email code" : "000000"}
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern={emailCodePending ? "[0-9]{6,10}" : "[0-9]{6}"}
                maxLength={emailCodePending ? 10 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={busy || (mfa && (!factor || code.length !== 6)) || (emailCodePending && !/^[0-9]{6,10}$/.test(code))}
          >
            {busyAction === "form" && (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {busyAction === "form" ? pendingAction : emailCodePending ? "Verify email code" : action}
          </Button>
          {mode === "recovery" && (
            <div className="flex flex-col gap-2 text-center text-sm">
              {emailCodePending ? <>
                <Button type="button" variant="outline" disabled={busy || !email.trim()} onClick={() => void resendRecoveryCode()}>Send a new code</Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEmailCodePending(false); setCode(""); setError(""); setMessage(""); }}>Change email or start again</Button>
              </> : <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEmailCodePending(true); setError(""); setMessage(""); }}>I already have a recovery code</Button>}
            </div>
          )}
          </FieldGroup>
        </form>
      )}
      {mode === "update-password" && !passwordSessionReady && !error && <p role="status" className="text-center text-sm text-muted-foreground">Checking your reset session…</p>}
      {mode === "update-password" && !passwordSessionReady && error && <Button asChild className="h-11 w-full"><Link href={recoveryPage(authDestinationFromSearch(typeof window === "undefined" ? "" : window.location.search))}>Request a new recovery code</Link></Button>}
      {error && (
        <div
          id="auth-error"
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}
      {message && (
        <div
          id="auth-message"
          role="status"
          className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm"
        >
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{message}</p>
        </div>
      )}
      <FieldDescription className="text-center">
        {mfa ? (
          <Link
            href={`/sign-in${nextQuery}`}
            className={`${authLink} inline-flex min-h-11 items-center`}
          >
            Back to sign in
          </Link>
        ) : mode === "sign-in" ? (
          <span>
            Don’t have an account?{" "}
            <Link
              href={`/sign-up${nextQuery}`}
              className={`${authLink} inline-flex min-h-11 items-center`}
            >
              Sign up
            </Link>
          </span>
        ) : mode === "sign-up" ? (
          <span>
            Already have an account?{" "}
            <Link
              href={`/sign-in${nextQuery}`}
              className={`${authLink} inline-flex min-h-11 items-center`}
            >
              Sign in
            </Link>
          </span>
        ) : mode === "update-password" ? (
          <Link href={authDestinationFromSearch(typeof window === "undefined" ? "" : window.location.search)} className={`${authLink} inline-flex min-h-11 items-center`}>
            Return to library
          </Link>
        ) : (
          <Link
            href={`/sign-in${nextQuery}`}
            className={`${authLink} inline-flex min-h-11 items-center`}
          >
            Back to sign in
          </Link>
        )}
      </FieldDescription>
    </AuthShell>
  );
}
