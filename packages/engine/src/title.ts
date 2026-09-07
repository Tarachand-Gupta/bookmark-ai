/**
 * Choosing a bookmark's title between what the server scraped and what the
 * client sent (the tab title at save time).
 *
 * The scraper runs from a datacenter, so sites that gate bots hand it a consent
 * wall, a bot check, or an error page: YouTube answers "- YouTube", Cloudflare
 * "Just a moment...", others "Access Denied". Those used to win over a perfectly
 * good client title because the scrape was trusted unconditionally
 * (three "- YouTube" rows in the reviewer library, 2026-09-07). A scraped title
 * is now only preferred when it carries information; otherwise the client's
 * title is kept, and the scrape is the fallback of last resort before the domain.
 */

export interface TitleContext {
  /** Hostname without a leading `www.` — what the bookmark row stores. */
  domain: string;
  /** `og:site_name` when the scrape had one. */
  siteName?: string | null;
}

/** Leading/trailing separator runs left behind when a page's title template has an empty slot ("- YouTube", "| Medium"). */
const EDGE_SEPARATORS = /^[\s\-–—|:·•]+|[\s\-–—|:·•]+$/g;

/** Titles served by consent walls, bot checks, login gates and error pages. */
const BLOCK_PAGE_TITLES: RegExp[] = [
  /^just a moment/i,
  /^one moment/i,
  /^please wait/i,
  /^attention required/i,
  /^access denied/i,
  /^access to this page has been denied/i,
  /^are you a (human|robot)/i,
  /^robot check/i,
  /^security check/i,
  /^verify you are human/i,
  /^before you continue/i, // Google consent interstitial
  /^(sign|log) ?in\b/i,
  // A bare status code, or one followed by its standard reason phrase — but
  // not an article whose title merely starts with a number ("404: the story…").
  /^(?:HTTP\s*)?(?:401|403|404|429|500|502|503)(?:\s*[-–—|:]?\s*(?:error|forbidden|not found|unauthorized|too many requests|bad gateway|service unavailable|internal server error|page not found))?$/i,
  /\bforbidden$/i,
  /^not found$/i,
  /^page not found$/i,
  /^error$/i,
  /^untitled( document)?$/i,
  /^unavailable$/i,
];

/** The part of a title that is not template separators, or null when nothing is left. */
function core(title: string | null | undefined): string | null {
  if (!title) return null;
  const stripped = title.replace(EDGE_SEPARATORS, "").trim();
  return stripped.length > 0 ? stripped : null;
}

/**
 * True when a title carries no information about the page: empty, only the
 * site's own name (bare or behind a separator), or a known block-page title.
 * A legitimate page title that merely equals the site name still counts as
 * junk here — the caller only uses this to ORDER candidates, never to drop the
 * last one, so such a title survives when nothing better exists.
 */
export function isJunkTitle(title: string | null | undefined, ctx: TitleContext): boolean {
  const c = core(title);
  if (!c) return true;
  const norm = c.toLowerCase();
  const domain = ctx.domain.toLowerCase();
  const labels = domain.split(".");
  // "youtube.com" → "youtube"; "docs.example.co.uk" → "docs.example.co" — the
  // exact registrable name does not matter, both spellings are compared.
  const domainName = labels.length > 1 ? labels.slice(0, -1).join(".") : domain;
  const siteName = ctx.siteName?.trim().toLowerCase() ?? "";
  if (norm === domain || norm === domainName || (siteName && norm === siteName)) return true;
  return BLOCK_PAGE_TITLES.some((re) => re.test(c));
}

/**
 * Pick the title to store. Order: an informative scraped title, then an
 * informative client title, then whichever of the two exists (scrape core
 * first — "- YouTube" degrades to "YouTube"), then the domain.
 */
export function pickBookmarkTitle(
  scraped: string | null | undefined,
  provided: string | null | undefined,
  ctx: TitleContext,
): string {
  const scrapedCore = core(scraped);
  const providedCore = core(provided);
  if (scrapedCore && !isJunkTitle(scrapedCore, ctx)) return scrapedCore;
  if (providedCore && !isJunkTitle(providedCore, ctx)) return providedCore;
  return scrapedCore ?? providedCore ?? ctx.domain;
}
