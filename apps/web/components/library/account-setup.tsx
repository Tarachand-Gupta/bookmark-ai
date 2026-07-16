"use client";

import { Loader2 } from "lucide-react";

/**
 * Shown while a brand-new account's private DB is being created. A signup lands
 * on /app a moment before provisioning finishes, so the first requests can 503 —
 * the hooks poll through that and the page shows this instead. It is a normal
 * couple of seconds of signup, never an error, so it stays calm: no warning
 * colors, no retry button (the polling is the retry), no mention of failure.
 */
export function AccountSetup() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-20 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
      <p className="font-medium">Setting up your account…</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        This only takes a moment — we&rsquo;re creating your private library.
      </p>
    </div>
  );
}
