"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { getAuthFlowSupabase } from "@/lib/native-auth-context";
import { authDestinationFromSearch } from "@/lib/auth-policy";
let exchange: Promise<void> | null = null;
export default function Callback() {
  const [error, setError] = useState("");
  const [nextQuery, setNextQuery] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const next = authDestinationFromSearch(window.location.search);
    setNextQuery(`?next=${encodeURIComponent(next)}`);
    if (!code || params.has("error")) {
      setError("This sign-in link is invalid or expired. Start again.");
      return;
    }
    exchange ??= getAuthFlowSupabase()
      .auth.exchangeCodeForSession(code)
      .then(async ({ error }) => {
        if (error) throw new Error("Sign-in failed.");
        window.history.replaceState(null, "", "/auth/callback?next=" + encodeURIComponent(next));
        const { data } = await getAuthFlowSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
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
    <AuthShell
      title={error ? "Sign-in could not finish" : "Finishing sign-in…"}
      description={
        error
          ? "Return to sign in to try again."
          : "Please wait while we securely connect your account."
      }
    >
      {error ? (
        <>
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
          <Button asChild className="h-11 w-full">
            <Link href={`/sign-in${nextQuery}`}>Return to sign in</Link>
          </Button>
        </>
      ) : (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Connecting your account…
        </p>
      )}
    </AuthShell>
  );
}
