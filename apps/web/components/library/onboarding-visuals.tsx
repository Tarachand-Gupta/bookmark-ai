"use client";

/**
 * Shared chrome for the onboarding tour: the numbered "how it works" list and
 * the stage that frames each real landing-page animation (see
 * onboarding-dialog.tsx, which now reuses the marketing mocks from
 * components/marketing/ instead of static screenshots).
 */

/**
 * Stage that frames a marketing animation inside the tour's narrow content
 * pane. Same visual vocabulary as the marketing mocks' own muted frames
 * (aria-hidden, inert, rounded-xl border, muted fill) so the animation reads
 * as one continuous "screen" rather than a demo bolted onto a demo.
 * `overflow-hidden` + `w-full` keep it from ever spilling past the ~490px
 * (desktop) / ~320px (mobile) content pane, however wide the animation's own
 * fixed-width internals get.
 */
export function TourStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none w-full select-none overflow-hidden rounded-xl border bg-muted/30 p-4"
    >
      {children}
    </div>
  );
}

/**
 * Styled "how it works" numbered list for the tour steps — muted, tightly-set
 * numbers in the app's own tokens (not raw markdown-y "1. text"). Each item is a
 * short instruction; keep them terse so panes stay compact.
 */
export function TourSteps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-snug">
          <span
            aria-hidden
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground"
          >
            {i + 1}
          </span>
          <span className="min-w-0 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}
