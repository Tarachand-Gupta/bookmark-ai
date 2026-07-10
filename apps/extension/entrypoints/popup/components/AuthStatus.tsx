import { useClerk, useUser } from "@clerk/chrome-extension";
import { browser } from "wxt/browser";

/**
 * Signed-in: avatar + name + sign-out. Signed-out: a button that opens the
 * web app's sign-in page — auth happens there (OAuth is not supported inside
 * extension popups) and the session syncs back via ClerkProvider's syncHost.
 */
export function AuthStatus({ webUrl }: { webUrl: string }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  if (!isLoaded) {
    return <div className="h-5 w-24 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!isSignedIn) {
    return (
      <button
        type="button"
        onClick={() => {
          void browser.tabs.create({ url: `${webUrl}/sign-in` });
          window.close();
        }}
        className="rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Sign in ↗
      </button>
    );
  }

  const name =
    user.firstName ?? user.username ?? user.primaryEmailAddress?.emailAddress ?? "Account";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {user.imageUrl ? (
        <img src={user.imageUrl} alt="" className="size-5 shrink-0 rounded-full" />
      ) : null}
      <span className="truncate text-xs font-medium" title={name}>
        {name}
      </span>
      <button
        type="button"
        onClick={() => void clerk.signOut()}
        className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
        title="Sign out"
      >
        Sign out
      </button>
    </div>
  );
}
