"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The signed-in Clerk account authenticated fine but isn't on the API's
 * allowlist (server 403 `code: "forbidden"`). This is NOT a "you're signed out"
 * problem — the user IS signed in, just with an identity that has no access
 * (the owner hit this when Google's account picker chose the wrong one). So we
 * deliberately avoid the "check that you're signed in" advice and instead name
 * the account and offer a one-click way to switch.
 *
 * Rendered wherever a list/load surface would otherwise show a raw error;
 * detection lives in the data hooks (`forbidden` flag from ForbiddenError).
 */
export function NoAccessNotice() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const email =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;

  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <ShieldAlert className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="font-medium">This account doesn&rsquo;t have access</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {email ? (
          <>
            You&rsquo;re signed in as{" "}
            <span className="font-medium text-foreground">{email}</span>, which isn&rsquo;t
            authorized to use this app.
          </>
        ) : (
          <>This account isn&rsquo;t authorized to use this app.</>
        )}{" "}
        Switch to an account that has access.
      </p>
      {/* Reuse the app's existing sign-out mechanism (Clerk) — no new auth UI.
          Land on /sign-in so the account picker comes straight back up. */}
      <Button variant="outline" size="sm" onClick={() => void signOut({ redirectUrl: "/sign-in" })}>
        Switch account
      </Button>
    </div>
  );
}
