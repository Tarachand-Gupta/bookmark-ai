"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import { getAuthFlowSupabase, nativeFlowFromLocation, nativeProviderHint } from "@/lib/native-auth-context";
import { authDestinationFromSearch, safeAuthDestination } from "@/lib/auth-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthShell } from "./auth-shell";
import { AppleIcon, GoogleIcon } from "./provider-icons";

const authLink =
  "rounded-sm font-medium text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function AuthForm({
  mode,
}: {
  mode: "sign-in" | "sign-up" | "recovery" | "update-password" | "mfa";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busyAction, setBusyAction] = useState<"form" | "google" | "apple" | null>(null);
  const busy = busyAction !== null;
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mfa, setMfa] = useState(mode === "mfa");
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [nativeEmailPending, setNativeEmailPending] = useState(false);
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
    setError("");
    setMessage("");
    try {
      const auth = getAuthFlowSupabase().auth;
      const next = authDestinationFromSearch(window.location.search);
      if (nativeEmailPending) {
        const result = await auth.verifyOtp({email,token:code,type:mode === "recovery" ? "recovery" : "signup"});
        if(result.error)throw result.error;
        window.location.assign(mode === "recovery" ? "/auth/update-password?next="+encodeURIComponent(next) : next);
      } else if (mfa) {
        const result = await auth.mfa.challengeAndVerify({ factorId: factor, code });
        if (result.error) throw result.error;
        window.location.assign(next);
      } else if (mode === "recovery") {
        const result = await auth.resetPasswordForEmail(email, {
          redirectTo: callback("/auth/update-password?next=" + encodeURIComponent(next)),
        });
        if (result.error) throw result.error;
        if(nativeFlowFromLocation()){setNativeEmailPending(true);setMessage("Enter the code from your recovery email here. Keep this browser window open.");}
        else setMessage("If an account exists for this address, check your email for a reset link.");
      } else if (mode === "update-password") {
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
        else if(nativeFlowFromLocation()){setNativeEmailPending(true);setPassword("");setMessage("Enter the code from your confirmation email here. Keep this browser window open.");}
        else setMessage("Check your email to confirm your account, then return to sign in.");
      } else {
        const result = await auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        const assurance = await auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance.data?.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
          setMfa(true);
          setPassword("");
          setShowPassword(false);
        } else window.location.assign(next);
      }
    } catch {
      setError("We could not complete that request. Check your details and try again.");
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
        recovery: "Enter your email and we’ll send you a reset link.",
        "update-password": "Choose a new password for your account.",
        mfa: "Enter the six-digit code from your authenticator app.",
      }[mode];
  const action = mfa
    ? "Verify"
    : mode === "recovery"
      ? "Send reset link"
      : mode === "update-password"
        ? "Update password"
        : mode === "sign-up"
          ? "Create account"
          : "Sign in";
  const pendingAction = mfa
    ? "Verifying…"
    : mode === "recovery"
      ? "Sending reset link…"
      : mode === "update-password"
        ? "Updating password…"
        : mode === "sign-up"
          ? "Creating account…"
          : "Signing in…";
  const showProviders = !mfa && !nativeEmailPending && (mode === "sign-in" || mode === "sign-up");
  const passwordUpdated = mode === "update-password" && Boolean(message);
  return (
    <AuthShell
      title={mfa ? "Verify your authenticator" : mode === "sign-in" ? "Welcome back" : title}
      description={description}
    >
      {showProviders && (
        <>
          <div className="grid gap-3">
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
          </div>
          <div className="relative text-center text-xs text-muted-foreground">
            <span aria-hidden className="absolute inset-x-0 top-1/2 border-t" />
            <span className="relative bg-card px-3">Or continue with email</span>
          </div>
        </>
      )}
      {!passwordUpdated && (
        <form
          onSubmit={submit}
          className="space-y-5"
          aria-busy={busy}
          aria-describedby={error ? "auth-error" : message ? "auth-message" : undefined}
        >
          {!mfa && !nativeEmailPending && mode === "sign-up" && (
            <div className="space-y-2">
              <label htmlFor="auth-name" className="text-sm font-medium">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="auth-name"
                className="h-11"
                autoComplete="name"
                placeholder="Your name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          {!mfa && !nativeEmailPending && mode !== "update-password" && (
            <div className="space-y-2">
              <label htmlFor="auth-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="auth-email"
                className="h-11"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
          {!mfa && !nativeEmailPending && mode !== "recovery" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="auth-password" className="text-sm font-medium">
                  {mode === "update-password" ? "New password" : "Password"}
                </label>
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
            </div>
          )}
          {(mfa || nativeEmailPending) && (
            <div className="space-y-2">
              <label htmlFor="auth-code" className="text-sm font-medium">
                {nativeEmailPending ? "Email code" : "Authenticator code"}
              </label>
              <Input
                id="auth-code"
                className="h-11 text-center font-mono tracking-widest"
                placeholder={nativeEmailPending ? "Email code" : "000000"}
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern={nativeEmailPending ? "[0-9]{6,10}" : "[0-9]{6}"}
                maxLength={nativeEmailPending ? 10 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          )}
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={busy || (mfa && (!factor || code.length !== 6)) || (nativeEmailPending && !/^[0-9]{6,10}$/.test(code))}
          >
            {busyAction === "form" && (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {busyAction === "form" ? pendingAction : nativeEmailPending ? "Verify email code" : action}
          </Button>
        </form>
      )}
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
      <div className="text-center text-sm text-muted-foreground">
        {mfa ? (
          <Link
            href={`/sign-in${nextQuery}`}
            className={`${authLink} inline-flex min-h-11 items-center`}
          >
            Back to sign in
          </Link>
        ) : mode === "sign-in" ? (
          <p>
            Don’t have an account?{" "}
            <Link
              href={`/sign-up${nextQuery}`}
              className={`${authLink} inline-flex min-h-11 items-center`}
            >
              Sign up
            </Link>
          </p>
        ) : mode === "sign-up" ? (
          <p>
            Already have an account?{" "}
            <Link
              href={`/sign-in${nextQuery}`}
              className={`${authLink} inline-flex min-h-11 items-center`}
            >
              Sign in
            </Link>
          </p>
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
      </div>
    </AuthShell>
  );
}
