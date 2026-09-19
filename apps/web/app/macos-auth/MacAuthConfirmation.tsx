"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";

interface Props {
  flowId: string;
  csrfToken: string;
  verificationCode: string;
  accountLabel: string;
  accountEmail: string | null;
}

type Result = "ready" | "submitting" | "approved" | "canceled" | "error";

export function MacAuthConfirmation({
  flowId,
  csrfToken,
  verificationCode,
  accountLabel,
  accountEmail,
}: Props) {
  const { signOut } = useClerk();
  const [result, setResult] = useState<Result>("ready");
  const [error, setError] = useState<string | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  async function submit(action: "approve" | "cancel") {
    setResult("submitting");
    setError(null);
    try {
      const response = await fetch("/api/macos-auth/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId, csrfToken, action }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Could not update this sign-in request");
      setResult(action === "approve" ? "approved" : "canceled");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this sign-in request");
      setResult("error");
    }
  }

  async function useAnotherAccount() {
    setSwitchingAccount(true);
    setError(null);
    try {
      const returnUrl = window.location.href;
      await signOut({ redirectUrl: `/sign-in?redirect_url=${encodeURIComponent(returnUrl)}` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not switch browser accounts");
      setSwitchingAccount(false);
    }
  }

  if (result === "approved") {
    return (
      <StatusCard
        symbol="✓"
        title="Sign-in confirmed"
        detail="Return to Bookmark AI for Mac. This browser stays signed in."
      />
    );
  }
  if (result === "canceled") {
    return <StatusCard symbol="×" title="Sign-in canceled" detail="You can close this tab and return to the Mac app." />;
  }

  return (
    <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-card-foreground shadow-xl">
      <div className="text-sm font-medium text-muted-foreground">Bookmark AI for Mac</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Confirm sign-in</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Verify that this code matches the one shown in the Mac app. Continue only if you started this request.
      </p>

      <div className="my-7 rounded-2xl border bg-muted/50 px-6 py-5 text-center">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Verification code</div>
        <div className="mt-2 font-mono text-3xl font-semibold tracking-[0.14em]" aria-label={`Verification code ${verificationCode}`}>
          {verificationCode}
        </div>
      </div>

      <div className="rounded-2xl border px-5 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account to use</div>
        <div className="mt-2 font-medium">{accountLabel}</div>
        {accountEmail ? <div className="mt-0.5 text-sm text-muted-foreground">{accountEmail}</div> : null}
        <button
          type="button"
          className="mt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
          onClick={useAnotherAccount}
          disabled={result === "submitting" || switchingAccount}
        >
          {switchingAccount ? "Signing out…" : "Sign out in this browser and use a different account"}
        </button>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          This signs the current account out of Bookmark AI in this browser before you choose another account.
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
        <button
          type="button"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          onClick={() => submit("approve")}
          disabled={result === "submitting" || switchingAccount}
        >
          {result === "submitting" ? "Confirming…" : "Continue to Bookmark AI for Mac"}
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border px-5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          onClick={() => submit("cancel")}
          disabled={result === "submitting" || switchingAccount}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StatusCard({ symbol, title, detail }: { symbol: string; title: string; detail: string }) {
  return (
    <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center text-card-foreground shadow-xl">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground">
        {symbol}
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}
