import { requestSignOut } from "@/lib/messages";

/**
 * Header sign-out control, shown only in the signed-in UI. Icon-only ghost
 * button (lucide "log-out" glyph, inlined — no icon dep) that reddens on hover
 * to signal the destructive action. Sign-out runs in the BACKGROUND (SDK +
 * production native fallback — the popup-side Clerk client cannot see a
 * production custom-domain session), then notifies App so it re-checks and
 * drops back to the sign-in gate without waiting for a poll.
 */
export function SignOutButton({ onSignedOut }: { onSignedOut?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => void requestSignOut().then(() => onSignedOut?.())}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      title="Sign out"
      aria-label="Sign out"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}
