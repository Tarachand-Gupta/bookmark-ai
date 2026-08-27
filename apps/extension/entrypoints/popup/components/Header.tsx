import { browser } from "wxt/browser";
import type { UserInfo } from "@/lib/messages";
import { AccountAvatar } from "./AccountAvatar";
import { SignOutButton } from "./SignOutButton";
import { BookmarkIcon } from "./ui/icons";

/**
 * One 32px row, identical in every popup state: the brand mark, the product
 * name, and (when signed in) the account chip plus sign-out.
 *
 * The signed-out gate and the Clerk-unavailable fallback render the same header
 * without `user`, so the popup never changes shape at the top.
 *
 * The title comes from the MANIFEST, not a literal, so the three side-by-side
 * installs still name themselves ("Bookmark AI" / "…(Dev)" / "…(Local)"). The
 * old header showed the per-target colour-coded icon for the same reason; the
 * design's brand tile replaces that plate, so the name carries the signal.
 */
function productName(): string {
  try {
    return browser.runtime.getManifest().name || "Bookmark AI";
  } catch {
    return "Bookmark AI";
  }
}

export function Header({ user, webUrl, onSignedOut }: {
  user?: UserInfo;
  webUrl?: string;
  onSignedOut?: () => void;
}) {
  return (
    <header className="flex min-h-8 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-primary">
        <BookmarkIcon className="size-[13px] text-primary-foreground" strokeWidth={2.2} />
      </span>
      <h1 className="truncate text-[13px] font-semibold tracking-[-0.01em]">{productName()}</h1>

      {user?.signedIn && (
        <div className="ml-auto flex items-center gap-1.5">
          <AccountAvatar name={user.name} email={user.email} />
          {webUrl && <SignOutButton webUrl={webUrl} onSignedOut={onSignedOut} />}
        </div>
      )}
    </header>
  );
}
