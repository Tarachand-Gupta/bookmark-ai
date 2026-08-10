/**
 * The two presentational primitives the demo animations need, living here so
 * every surface that renders them shares one definition: the marketing landing
 * page, the in-app onboarding tour, and the documentation site.
 *
 * `apps/web/components/marketing/primitives.tsx` re-exports both, so the
 * landing page keeps importing them from its own module and nothing drifts.
 */

/**
 * The marketing mono voice. Resolves `--font-mono-marketing` when the host page
 * defines it (the landing page applies JetBrains Mono via next/font), and falls
 * back to the platform mono stack anywhere that doesn't — which is what lets
 * these demos drop into the docs site without shipping a webfont.
 */
export const mono = "font-[family-name:var(--font-mono-marketing,ui-monospace)]";

/** The brand ribbon mark (same silhouette as app/icon.svg), inheriting color. */
export function BookmarkMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M19 21 L12 17 L5 21 V5 A2 2 0 0 1 7 3 H17 A2 2 0 0 1 19 5 Z" />
    </svg>
  );
}
