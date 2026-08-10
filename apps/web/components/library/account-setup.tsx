"use client";

import { Bookmark } from "lucide-react";

/**
 * PROVISIONING SCREEN — shown while a brand-new account's private DB is being
 * created (any API answering 503 `{code:"provisioning"}`; see ProvisioningError in
 * lib/api.ts, which every hook classifies centrally so the library, the dashboard
 * and the sidebar's /api/meta all land on THIS one screen instead of three
 * unrelated spinners).
 *
 * It deliberately takes over the whole viewport (`fixed inset-0`) rather than
 * rendering inside the content column: a half-built shell — pulsing sidebar
 * facets, an empty header, skeleton cards — reads as a broken app, and this is
 * the first thing a new signup ever sees. Owning the screen also lets it carry
 * the brand mark, which is why the mark is repeated here even though the sidebar
 * normally shows it. Mounted ONLY while provisioning is true, so it can never
 * cover a working app.
 *
 * Tone: this is a normal 10-15 seconds of signup, never an error — no warning
 * colors, no retry button (the hooks re-fire the failed request every 2s, which
 * IS the retry), no mention of failure. The privacy line is the honest reason the
 * wait exists at all: one isolated database per account.
 */
export function AccountSetup() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background px-6"
      role="status"
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
        <p className="text-center text-sm font-medium">Setting up your account</p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          This usually takes 10&ndash;15 seconds.
        </p>
        {/* Indeterminate, not a progress bar: provisioning gives us no percentage,
            and a fake one that stalls at 90% is worse than honest motion. The
            travelling sliver is CSS-only (see .provisioning-shimmer in
            globals.css) and degrades to a still, dimmed track under
            prefers-reduced-motion. */}
        <div
          className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          {/* Width/animation live in the CSS class (unlayered, so it also beats a
              Tailwind width utility if one is ever added here). */}
          <div className="provisioning-shimmer h-full rounded-full bg-primary/70" />
        </div>
      </div>

      <p className="max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
        We take privacy seriously &mdash; every account gets its own isolated database, and
        we&rsquo;re creating yours right now.
      </p>
    </div>
  );
}
