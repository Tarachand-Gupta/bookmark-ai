import { useUser } from "@clerk/chrome-extension";
import { displayIdentity } from "@/lib/identity";

/**
 * A subtle secondary line under the wordmark naming who's signed in — the full
 * name when both parts are set, otherwise a masked email. Renders nothing while
 * Clerk is loading, when signed out, or when there's no name/email to show, so
 * the header never flashes a placeholder identity.
 */
export function HeaderIdentity() {
  const { isLoaded, isSignedIn, user } = useUser();
  if (!isLoaded || !isSignedIn) return null;

  const identity = displayIdentity({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.primaryEmailAddress?.emailAddress,
  });
  if (!identity) return null;

  return (
    <p className="truncate text-[11px] leading-tight text-muted-foreground" title={identity}>
      {identity}
    </p>
  );
}
