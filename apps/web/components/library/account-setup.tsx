"use client";

import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccountSetup({ state = "provisioning", onRetry }: {
  state?: "checking" | "provisioning" | "error";
  onRetry?: () => void;
} = {}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background px-6"
      role={state === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {/* Same mark treatment as the sidebar header — square, primary fill. */}
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Bookmark className="size-4.5" aria-hidden />
        </span>
        <span className="text-base font-semibold tracking-tight">Bookmark AI</span>
      </div>

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-center text-base font-semibold">{state === "error" ? "We couldn’t open your account" : state === "checking" ? "Opening your account" : "Setting up your account"}</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {state === "error" ? "Your account isn’t ready yet. Try again to continue." : state === "checking" ? "Checking that everything is ready…" : "This usually takes 10–20 seconds."}
        </p>
        {/* Indeterminate, not a progress bar: provisioning gives us no percentage,
            and a fake one that stalls at 90% is worse than honest motion. The
            travelling sliver is CSS-only (see .provisioning-shimmer in
            globals.css) and degrades to a still, dimmed track under
            prefers-reduced-motion. */}
        {state !== "error" && <div
          className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          {/* Width/animation live in the CSS class (unlayered, so it also beats a
              Tailwind width utility if one is ever added here). */}
          <div className="provisioning-shimmer h-full rounded-full bg-primary/70" />
        </div>}
        {state === "error" && <Button className="mt-5 w-full" onClick={onRetry ?? (() => window.location.reload())}>Try again</Button>}
      </div>

      <p className="max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
        {state === "provisioning" ? "We’re getting your private library ready." : "Your bookmarks and saved sessions stay in your private library."}
      </p>
    </div>
  );
}
