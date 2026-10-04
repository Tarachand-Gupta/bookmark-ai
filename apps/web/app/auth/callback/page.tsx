"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/auth";
import { safeAuthDestination } from "@/lib/auth-policy";
let exchange: Promise<void> | null = null;
export default function Callback() {
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const next = safeAuthDestination(params.get("next"));
    if (!code || params.has("error")) {
      setError("This sign-in link is invalid or expired. Start again.");
      return;
    }
    exchange ??= getBrowserSupabase()
      .auth.exchangeCodeForSession(code)
      .then(async ({ error }) => {
        if (error) throw new Error("Sign-in failed.");
        window.history.replaceState(null, "", "/auth/callback");
        const { data } = await getBrowserSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
        window.location.replace(
          data?.nextLevel === "aal2" && data.currentLevel !== "aal2"
            ? "/auth/mfa?next=" + encodeURIComponent(next)
            : next,
        );
      });
    void exchange.catch(() => {
      exchange = null;
      setError(
        "This sign-in link could not be used. Open it in the browser where you started signing in, or start again.",
      );
    });
  }, []);
  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="text-xl font-semibold">
        {error ? "Sign-in could not finish" : "Finishing sign-in…"}
      </h1>
      {error && (
        <>
          <p role="alert">{error}</p>
          <Link href="/sign-in">Return to sign in</Link>
        </>
      )}
    </main>
  );
}
