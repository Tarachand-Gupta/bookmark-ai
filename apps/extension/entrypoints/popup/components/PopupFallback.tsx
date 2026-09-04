import { useEffect, useState } from "react";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { openApp } from "../nav";
import { Header } from "./Header";
import { PopupShell } from "./PopupShell";
import { Button } from "./ui/button";
import { ExternalLinkIcon } from "./ui/icons";

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
    <PopupShell>
      <Header />

      <p className="text-[11px] leading-snug text-muted-foreground">
        Sign-in is unavailable in this browser build. Open the web app to save and browse your
        bookmarks.
      </p>

      <Button variant="primary" onClick={() => openApp(webUrl)}>
        <ExternalLinkIcon className="size-[15px]" strokeWidth={2.2} />
        Open Bookmark AI
      </Button>
    </PopupShell>
  );
}
