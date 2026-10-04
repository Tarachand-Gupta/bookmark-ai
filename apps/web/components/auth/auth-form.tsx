"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/auth";
import { safeAuthDestination } from "@/lib/auth-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function AuthForm({
  mode,
}: {
  mode: "sign-in" | "sign-up" | "recovery" | "update-password" | "mfa";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mfa, setMfa] = useState(mode === "mfa");
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [nextQuery, setNextQuery] = useState("");
  useEffect(() => {
    const destination = safeAuthDestination(new URLSearchParams(location.search).get("next"));
    setNextQuery(`?next=${encodeURIComponent(destination)}`);
  }, []);
  useEffect(() => {
    if (mfa)
      void getBrowserSupabase()
        .auth.mfa.listFactors()
        .then(({ data }) => setFactor(data?.totp.find((f) => f.status === "verified")?.id ?? ""));
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
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const auth = getBrowserSupabase().auth;
      const next = safeAuthDestination(
        new URLSearchParams(window.location.search).get("next") ??
          new URLSearchParams(window.location.search).get("redirect_url"),
      );
      if (mfa) {
        const result = await auth.mfa.challengeAndVerify({ factorId: factor, code });
        if (result.error) throw result.error;
        window.location.assign(next);
      } else if (mode === "recovery") {
        const result = await auth.resetPasswordForEmail(email, {
          redirectTo: callback("/auth/update-password"),
        });
        if (result.error) throw result.error;
        setMessage("If an account exists for this address, check your email for a reset link.");
      } else if (mode === "update-password") {
        const result = await auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword("");
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
        else setMessage("Check your email to confirm your account, then return to sign in.");
      } else {
        const result = await auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        const assurance = await auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance.data?.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
          setMfa(true);
          setPassword("");
        } else window.location.assign(next);
      }
    } catch {
      setError("We could not complete that request. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function social(provider: "google" | "apple") {
    setBusy(true);
    setError("");
    try {
      const next = safeAuthDestination(new URLSearchParams(window.location.search).get("next"));
      const { error } = await getBrowserSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: callback(next) },
      });
      if (error) throw error;
    } catch {
      setError("Sign-in is temporarily unavailable. Try again.");
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6">
        <Link href="/" className="text-sm font-medium">
          Bookmark AI
        </Link>
        <h1 className="text-2xl font-semibold">{mfa ? "Verify your authenticator" : title}</h1>
        {!mfa && (mode === "sign-in" || mode === "sign-up") && (
          <div className="grid gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void social("google")}>
              Continue with Google
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void social("apple")}>
              Continue with Apple
            </Button>
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          {!mfa && mode === "sign-up" && (
            <label className="block text-sm">
              Name
              <Input
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {!mfa && mode !== "update-password" && (
            <label className="block text-sm">
              Email
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {!mfa && mode !== "recovery" && (
            <label className="block text-sm">
              Password
              <Input
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {mfa && (
            <label className="block text-sm">
              Authenticator code
              <Input
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
          )}
          <Button className="w-full" disabled={busy || (mfa && (!factor || code.length !== 6))}>
            {busy ? "Please wait…" : mfa ? "Verify" : title}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-sm underline">
          <Link href={`/sign-in${nextQuery}`}>Sign in</Link>
          <Link href={`/sign-up${nextQuery}`}>Create account</Link>
          <Link href={`/auth/recovery${nextQuery}`}>Forgot password?</Link>
          {mode === "update-password" && <Link href="/app">Return to library</Link>}
        </div>
      </section>
    </main>
  );
}
