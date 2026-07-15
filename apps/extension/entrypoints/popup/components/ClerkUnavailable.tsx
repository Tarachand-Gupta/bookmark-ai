import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";

/**
 * Fallback rendered by ClerkBoundary when `@clerk/chrome-extension` fails to
 * initialize (e.g. its `validateManifest` throws on a browser build). Uses no
 * Clerk hooks — the whole ClerkProvider subtree is gone at this point — and
 * keeps the popup useful with a one-tap link into the web app, where sign-in
 * and saving still work.
 */
export function ClerkUnavailable() {
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);

  useEffect(() => {
    void getWebBaseUrl().then(setWebUrl);
  }, []);

  return (
    <div className="flex min-w-[20rem] flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          B
        </span>
        <h1 className="text-sm font-semibold tracking-tight">Bookmark AI</h1>
      </header>

      <p className="text-xs text-muted-foreground">
        Sign-in is unavailable in this browser build. Open the web app to save and browse your
        bookmarks.
      </p>

      <button
        type="button"
        onClick={() => {
          void browser.tabs.create({ url: `${webUrl}/app` });
          window.close();
        }}
        className="inline-flex h-9 w-full items-center justify-center rounded-lg border bg-secondary text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80"
      >
        Open Bookmark AI ↗
      </button>
    </div>
  );
}
