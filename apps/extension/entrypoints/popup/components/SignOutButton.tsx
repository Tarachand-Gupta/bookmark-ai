import { requestSignOut } from "@/lib/messages";

/**
 * Header sign-out control, shown only in the signed-in UI. Sign-out runs in
 * the BACKGROUND (SDK + production native fallback — the popup-side Clerk
 * client cannot see a production custom-domain session), then notifies App so
 * it re-checks and drops back to the sign-in gate without waiting for a poll.
 */
export function SignOutButton({ onSignedOut }: { onSignedOut?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => void requestSignOut().then(() => onSignedOut?.())}
      className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Sign out"
    >
      Sign out
    </button>
  );
}
