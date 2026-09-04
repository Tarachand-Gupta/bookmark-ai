import { useEffect, useState } from "react";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { openApp } from "../nav";
import { Header } from "./Header";
import { PopupShell } from "./PopupShell";
import { Button } from "./ui/button";
import { ExternalLinkIcon } from "./ui/icons";

/**
 * Rendered by PopupErrorBoundary when the popup tree throws. Uses nothing from
 * the crashed subtree — just the shared shell/header and a one-tap link into
 * the web app, where saving and browsing still work. Same shape as the sign-in
 * gate, so even the failure state doesn't reshape the popup.
 */
export function PopupFallback() {
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);

  useEffect(() => {
    void getWebBaseUrl().then(setWebUrl);
  }, []);

  return (
    <PopupShell>
      <Header />

      <p className="text-[11px] leading-snug text-muted-foreground">
        The popup ran into a problem. Open the web app to save and browse your bookmarks — then
        reopen this popup.
      </p>

      <Button variant="primary" onClick={() => openApp(webUrl)}>
        <ExternalLinkIcon className="size-[15px]" strokeWidth={2.2} />
        Open Bookmark AI
      </Button>
    </PopupShell>
  );
}
