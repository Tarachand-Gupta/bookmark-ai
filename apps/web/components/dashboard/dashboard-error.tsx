"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What Home shows when its one aggregated read (`/api/dashboard`) came back with
 * nothing usable — no fresh payload AND no cached snapshot to fall back on.
 *
 * It exists because the page used to render NOTHING in that case: a brand-new
 * account whose first load failed (a tenant DB that was still being created past
 * the hook's provisioning window, a 5xx from provisioning itself) got the header
 * and the omnibox over an empty white screen, with no message and no way to try
 * again short of guessing that a reload might help.
 *
 * Deliberately a quiet panel, not a red alarm: on the path that produces it most
 * often — the first seconds of a new account — the honest reading is "not ready
 * yet", not "something is broken". The retry is the important part; the hook has
 * already backed off and re-tried on its own before this ever renders.
 */
export function DashboardError({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center text-card-foreground"
      role="alert"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <TriangleAlert className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="font-medium">We couldn&rsquo;t load your home page</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {/* A brand-new account is the common case here, so say so first — the
            raw server message goes second, in a quieter voice, for the times
            it's actually something else. */}
        If you just created your account, it may still be getting set up. Try again in a
        moment.
        {message ? <span className="mt-1 block text-xs opacity-80">{message}</span> : null}
      </p>
      <Button onClick={onRetry} variant="outline" className="mt-1">
        <RefreshCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
