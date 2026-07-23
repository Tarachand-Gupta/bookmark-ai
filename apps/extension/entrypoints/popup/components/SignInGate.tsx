import { browser } from "wxt/browser";
import { iconUrl } from "@/lib/icon";

/**
 * The entire popup when no one is signed in: a sign-in prompt and nothing else
 * (no save button, no session controls). The button opens the build-target web
 * app's sign-in page in a new tab — sign-in happens there (OAuth is unsupported
 * inside extension popups) and Clerk's syncHost mirrors the session back, at
 * which point App's poll promotes the popup to the signed-in UI.
 */
export function SignInGate({ webUrl, note }: { webUrl: string; note?: string }) {
  return (
    <div className="flex min-w-[20rem] flex-col gap-4 p-5">
      <header className="flex items-center gap-2">
        <img src={iconUrl()} alt="" className="size-8 shrink-0 rounded-lg" />
        <h1 className="text-sm font-semibold tracking-tight">Bookmark AI</h1>
      </header>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium leading-tight">Sign in to get started</p>
        <p className="text-xs leading-snug text-muted-foreground">
          Sign in on the Bookmark AI website to save and browse your bookmarks. Your session syncs
          back here automatically.
        </p>
      </div>

      {/* Shown when the popup fell back to this gate because the background never
          answered (e.g. a hung Clerk client) rather than a confirmed sign-out. */}
      {note && (
        <p className="rounded-md border border-dashed px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {note}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          void browser.tabs.create({ url: `${webUrl}/sign-in` });
          window.close();
        }}
        className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Sign in ↗
      </button>
    </div>
  );
}
