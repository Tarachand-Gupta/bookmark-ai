import { useClerk } from "@clerk/chrome-extension";

/**
 * Header sign-out control, shown only in the signed-in UI. Signs out of the
 * extension's mirrored Clerk session, then notifies App so it re-checks and
 * drops back to the sign-in gate without waiting for the next poll.
 */
export function SignOutButton({ onSignedOut }: { onSignedOut?: () => void }) {
  const clerk = useClerk();
  return (
    <button
      type="button"
      onClick={() => void clerk.signOut().then(() => onSignedOut?.())}
      className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Sign out"
    >
      Sign out
    </button>
  );
}
