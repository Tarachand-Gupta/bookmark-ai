import type { OpenGraph } from "@bookmark-ai/types";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 512 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; BookmarkAI/0.1; +https://github.com/bookmark-ai) AppleWebKit/537.36";

export interface ScrapeResult {
  og: OpenGraph;
  /** Best available title after OG/meta/title-tag fallbacks. */
  title: string | null;
  description: string | null;
}

/**
 * Fetch a page and extract Open Graph metadata (with standard-meta and
 * <title> fallbacks). Never throws: unreachable pages yield empty OG data so
 * a bookmark can always be saved.
 */
export async function scrapeOpenGraph(url: string): Promise<ScrapeResult> {
  const empty: ScrapeResult = { og: {}, title: null, description: null };
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return empty;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && contentType !== "") return empty;
    html = truncate(await res.text(), MAX_HTML_BYTES);
  } catch {
    return empty;
  }

  const metas = parseMetaTags(html);
  const og: OpenGraph = {
    title: metas.get("og:title") ?? metas.get("twitter:title") ?? null,
    description:
      metas.get("og:description") ?? metas.get("twitter:description") ?? metas.get("description") ?? null,
    image: absoluteUrl(metas.get("og:image") ?? metas.get("twitter:image"), url),
    siteName: metas.get("og:site_name") ?? null,
    type: metas.get("og:type") ?? null,
    url: absoluteUrl(metas.get("og:url"), url) ?? url,
    favicon: absoluteUrl(parseFavicon(html), url) ?? defaultFavicon(url),
  };

  const titleTag = parseTitleTag(html);
  return {
    og,
    title: og.title ?? titleTag,
    description: og.description ?? null,
  };
}

/** Collect <meta property|name="…" content="…"> pairs, attribute order agnostic. */
function parseMetaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const metaRe = /<meta\s[^>]*>/gi;
  for (const match of html.matchAll(metaRe)) {
    const tag = match[0];
    const key = attr(tag, "property") ?? attr(tag, "name");
    const content = attr(tag, "content");
    if (key && content && !out.has(key.toLowerCase())) {
      out.set(key.toLowerCase(), decodeEntities(content).trim());
    }
  }
  return out;
}

function parseTitleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1]).trim().slice(0, 300) || null : null;
}

function parseFavicon(html: string): string | null {
  const linkRe = /<link\s[^>]*>/gi;
  let fallback: string | null = null;
  for (const match of html.matchAll(linkRe)) {
    const tag = match[0];
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel === "icon" || rel === "shortcut icon") return href;
    if (rel.includes("icon") && !fallback) fallback = href;
  }
  return fallback;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  return m ? (m[2] ?? m[3] ?? null) : null;
}

function absoluteUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function defaultFavicon(url: string): string | null {
  try {
    return new URL("/favicon.ico", url).toString();
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
