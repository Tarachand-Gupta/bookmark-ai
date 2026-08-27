import { useState } from "react";
import { domainOf } from "../nav";
import { Button } from "./ui/button";
import { BookmarkIcon, GlobeIcon } from "./ui/icons";
import { Spinner } from "./Spinner";

export interface TabInfo {
  url: string;
  title?: string;
  favIconUrl?: string;
}

/**
 * The hero: the page you are looking at, and the ONE solid button in the popup.
 * Everything else on the default screen is a quiet bordered tile, so the primary
 * action never has to compete for attention.
 *
 * The favicon tile shows the real favicon and falls back to a globe glyph — a
 * page with no icon, a `data:` favicon Chrome refuses to hand over, or a load
 * error all land on the same neutral mark instead of the old `⚑` placeholder.
 */
export function HeroSaveCard({
  tab,
  saving,
  savable,
  busy,
  onSave,
}: {
  tab: TabInfo | null;
  saving: boolean;
  /** The active tab is an http(s) page we can actually bookmark. */
  savable: boolean;
  /** Any save (bookmark or session) is in flight — the button waits, but the
   * page is not "un-bookmarkable", so no explanatory note. */
  busy: boolean;
  onSave: () => void;
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const showFavicon = Boolean(tab?.favIconUrl) && !faviconFailed;
  const domain = domainOf(tab?.url);

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {showFavicon ? (
            <img
              src={tab!.favIconUrl}
              alt=""
              className="size-4"
              onError={() => setFaviconFailed(true)}
            />
          ) : (
            <GlobeIcon className="size-[15px] text-muted-foreground" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-px">
          <p className="truncate text-[13px] font-medium">
            {tab?.title || tab?.url || "No active tab"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {domain || "Open a page to bookmark it"}
          </p>
        </div>
      </div>

      <Button variant="primary" onClick={onSave} disabled={!savable || busy || saving}>
        {saving ? <Spinner /> : <BookmarkIcon className="size-[15px]" strokeWidth={2.2} />}
        {saving ? "Saving…" : "Save bookmark"}
      </Button>

      {/* An un-bookmarkable page (chrome://, about:, a file url) says so rather
          than leaving a dead button unexplained. */}
      {!savable && tab !== null && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          This page can’t be bookmarked.
        </p>
      )}
    </section>
  );
}
