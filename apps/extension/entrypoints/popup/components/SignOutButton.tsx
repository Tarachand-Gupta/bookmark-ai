import { requestSignOut } from "@/lib/messages";
import { openApp } from "../nav";
import { IconButton } from "./ui/button";
import { LogOutIcon } from "./ui/icons";

/**
 * Header sign-out control, shown only in the signed-in UI. A 24px ghost icon
 * button (lucide "log-out" glyph from the shared icon set) that reddens on hover
 * to signal the destructive action. Sign-out runs in the BACKGROUND (SDK +
 * production native fallback — the popup-side Clerk client cannot see a
 * production custom-domain session), then notifies App so it re-checks and
 * drops back to the sign-in gate without waiting for a poll. On Safari's cookie
 * path the background can't end the shared session, so it asks the popup to open
 * the web app (`openWeb`) where the user signs out instead.
 */
export function SignOutButton({
  webUrl,
  onSignedOut,
}: {
  webUrl: string;
  onSignedOut?: () => void;
}) {
  return (
    <IconButton
      tone="destructive"
      onClick={() =>
        void requestSignOut().then((res) => {
          if (res.openWeb) openApp(webUrl);
          else onSignedOut?.();
        })
      }
      title="Sign out"
      aria-label="Sign out"
    >
      <LogOutIcon className="size-3.5" />
    </IconButton>
  );
}
