import { openSignIn } from "../nav";
import { Header } from "./Header";
import { PopupShell } from "./PopupShell";
import { Button } from "./ui/button";
import { ExternalLinkIcon } from "./ui/icons";

/**
 * The entire popup when no one is signed in: a sign-in prompt and nothing else
 * (no save button, no session controls). The button opens the build-target web
 * app's sign-in page in a new tab — sign-in happens there (OAuth is unsupported
 * inside extension popups) and Clerk's syncHost mirrors the session back, at
 * which point App's poll promotes the popup to the signed-in UI.
 *
 * Same shell and same header as the signed-in UI, so promotion doesn't reshape
 * the popup; the one solid button is the only call to action on the screen.
 */
export function SignInGate({
  webUrl,
  note,
  reconnectAs,
}: {
  webUrl: string;
  note?: string;
  /** Safari: the last-known signed-in identity (display string). The web
   * session is almost certainly still alive but invisible to the extension
   * until an app tab is open, so the gate offers "reconnect" — one click, no
   * credentials — instead of a misleading "sign in". */
  reconnectAs?: string;
}) {
  const reconnect = reconnectAs !== undefined;
  return (
    <PopupShell>
      <Header />

      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold">
          {reconnect
            ? `Welcome back${reconnectAs ? `, ${reconnectAs}` : ""}`
            : "Sign in to get started"}
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {reconnect
            ? "You're still signed in on the website — Safari just needs a Bookmark AI tab open to reconnect the extension. Open the app and this popup picks the session up automatically."
            : "Sign in on the Bookmark AI website to save and browse your bookmarks. Your session syncs back here automatically."}
        </p>
      </div>

      {/* Shown when the popup fell back to this gate because the background never
          answered (e.g. a hung Clerk client) rather than a confirmed sign-out. */}
      {note && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {note}
        </p>
      )}

      <Button variant="primary" onClick={() => openSignIn(webUrl, reconnect)}>
        <ExternalLinkIcon className="size-[15px]" strokeWidth={2.2} />
        {reconnect ? "Open Bookmark AI" : "Sign in"}
      </Button>
    </PopupShell>
  );
}
