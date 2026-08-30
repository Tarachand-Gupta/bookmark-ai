import { GeminiClient } from "./gemini";
import { followRedirects, readCapped } from "./net-guard";

/**
 * Outward-facing web tools for the chat agent: read a specific page, or run a
 * keyless web search. Both reach the public internet, so `fetchUrl` goes
 * through the same SSRF guard as the Open Graph scraper (see net-guard.ts).
 */

const FETCH_URL_MAX_BYTES = 5 * 1024 * 1024; // read budget before text extraction
const MAX_TEXT_CHARS = 40_000; // cap on returned readable text

const WEBSEARCH_MAX_BYTES = 1024 * 1024;
const WEBSEARCH_TIMEOUT_MS = 10_000;
// DuckDuckGo's HTML endpoint refuses non-browser agents — present a desktop one.
const WEBSEARCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface FetchUrlResult {
  /** The final URL after redirects. */
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
}

/**
 * Fetch a single web page and return its readable text. SSRF-guarded (http/https
 * only, private/reserved hosts blocked, ≤3 manually re-validated redirects).
 * Only text/HTML/XHTML responses are read — binaries are rejected. Scripts,
 * styles and markup are stripped, entities decoded, whitespace collapsed, and
 * the text capped at ~40k chars. Throws on block / non-OK / non-text / timeout
 * so the agent can see why and react.
 */
export async function fetchUrl(url: string): Promise<FetchUrlResult> {
  const res = await followRedirects(url, {
    accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    maxRedirects: 3,
  });
  if (res === null) throw new Error(`Too many redirects while fetching ${url}`);

  const finalUrl = res.url || url;
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Fetch failed (HTTP ${res.status}) for ${finalUrl}`);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const isText =
    contentType === "" ||
    contentType.startsWith("text/") ||
    contentType.includes("xhtml") ||
    contentType.includes("+xml") ||
    contentType.includes("application/xml");
  if (!isText) {
    await res.body?.cancel().catch(() => {});
    throw new Error(
      `Cannot read ${finalUrl}: content-type "${contentType}" is not a text/HTML page`,
    );
  }

  const body = await readCapped(res, FETCH_URL_MAX_BYTES);
  const title = extractTitle(body);
  const full = htmlToText(body);
  const truncated = full.length > MAX_TEXT_CHARS;
  const text = truncated ? `${full.slice(0, MAX_TEXT_CHARS)}…` : full;
  return { url: finalUrl, title, text, truncated };
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const ANSWER_MAX_CHARS = 4_000;
const SNIPPET_MAX_CHARS = 300;

/**
 * The chat agent's webSearch backend. Primary: Gemini's Google Search
 * grounding (`GeminiClient.groundedSearch`) — a plain Google API call, so it
 * works from serverless egress IPs. The keyless DuckDuckGo scrape below is the
 * fallback for self-host installs without a Gemini key (and for a grounding
 * outage); in production the scrape alone was effectively dead — DDG refuses
 * Vercel's egress IPs, so every search came back `blocked`.
 *
 * Returns the scrape's `{results, blocked?}` shape extended with `answer`: a
 * synthesized, source-grounded reply the agent can lean on directly. Never
 * throws.
 */
export async function webSearchWithFallback(
  gemini: GeminiClient | null,
  query: string,
  limit = 5,
): Promise<{ results: WebSearchResult[]; answer?: string; blocked?: boolean }> {
  const capped = Math.min(Math.max(1, Math.floor(limit) || 5), 8);
  if (gemini && query.trim()) {
    try {
      const grounded = await gemini.groundedSearch(query);
      if (grounded.answer || grounded.sources.some((s) => s.uri)) {
        const results: WebSearchResult[] = [];
        for (let i = 0; i < grounded.sources.length && results.length < capped; i++) {
          const source = grounded.sources[i];
          if (!source?.uri) continue;
          // The first answer segment citing this source doubles as its snippet.
          const support = grounded.supports.find((s) => s.sourceIndices.includes(i));
          results.push({
            title: source.title || source.uri,
            url: source.uri,
            snippet: (support?.text ?? "").slice(0, SNIPPET_MAX_CHARS),
          });
        }
        return { results, answer: grounded.answer.slice(0, ANSWER_MAX_CHARS) };
      }
      // Grounded call succeeded but carried nothing usable — try the scrape.
      console.warn("[webSearch] grounded search returned no answer/sources; falling back to scrape");
    } catch (err) {
      // Grounding unavailable (quota, network, key restriction) — try the scrape.
      console.warn("[webSearch] grounded search failed; falling back to scrape:", err);
    }
  }
  return webSearch(query, capped);
}

/**
 * Keyless web search via DuckDuckGo's HTML endpoint, parsed dependency-free.
 *
 * This is a best-effort HTML scrape and is inherently fragile — DuckDuckGo can
 * change its markup or rate-limit at any time. It never throws: on any network,
 * timeout, or non-OK failure it returns `{ results: [], blocked: true }`; a
 * successful, fully-parsed but genuinely empty response returns `{ results: [] }`
 * (no `blocked` flag). Swap in a keyed search provider here later for reliability.
 */
export async function webSearch(
  query: string,
  limit = 5,
): Promise<{ results: WebSearchResult[]; blocked?: boolean }> {
  const capped = Math.min(Math.max(1, Math.floor(limit) || 5), 8);
  const q = query.trim();
  if (!q) return { results: [] };

  try {
    // SECURITY (finding #6): route through the SSRF guard (same as fetchUrl / the
    // OG scraper) so any redirect hop is re-validated + IP-pinned. The host is
    // fixed, so normal behavior is unchanged — this only hardens redirects.
    const res = await followRedirects(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      {
        userAgent: WEBSEARCH_USER_AGENT,
        accept: "text/html",
        timeoutMs: WEBSEARCH_TIMEOUT_MS,
      },
    );
    // SECURITY (finding #7): a blocked/failed fetch is distinct from a genuine
    // empty result set — flag it so the caller doesn't read "no results" as fact.
    if (res === null) return { results: [], blocked: true }; // redirect budget exceeded
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { results: [], blocked: true };
    }
    const html = await readCapped(res, WEBSEARCH_MAX_BYTES);
    return { results: parseDuckDuckGo(html, capped) };
  } catch {
    return { results: [], blocked: true }; // network error / timeout / SSRF block
  }
}

/** Parse DuckDuckGo HTML results: `result__a` anchors + `result__snippet` blocks, index-zipped. */
function parseDuckDuckGo(html: string, limit: number): WebSearchResult[] {
  const anchorRe = /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
  const snippetRe =
    /<(?:a|div|td)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/gi;

  const snippets: string[] = [];
  for (const m of html.matchAll(snippetRe)) {
    snippets.push(decodeEntities(stripTags(m[1] ?? "")).trim());
  }

  const results: WebSearchResult[] = [];
  let idx = 0;
  for (const m of html.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1];
    const realUrl = resolveDdgHref(href);
    const title = decodeEntities(stripTags(m[2] ?? "")).trim();
    const i = idx++;
    if (!realUrl || !title) continue;
    results.push({ title, url: realUrl, snippet: snippets[i] ?? "" });
    if (results.length >= limit) break;
  }
  return results;
}

/** Turn a DuckDuckGo href (often a `/l/?uddg=<encoded>` redirect) into the real target URL. */
function resolveDdgHref(href: string | undefined): string | null {
  if (!href) return null;
  let h = href;
  if (h.startsWith("//")) h = `https:${h}`;
  const uddg = /[?&]uddg=([^&]+)/.exec(h)?.[1];
  if (uddg) {
    try {
      return decodeURIComponent(uddg);
    } catch {
      return null;
    }
  }
  return /^https?:\/\//i.test(h) ? h : null;
}

/** Extract the `<title>` text (decoded, trimmed, capped) before markup is stripped. */
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  return decodeEntities(stripTags(m[1])).trim().slice(0, 300) || null;
}

/**
 * Reduce an HTML document to readable plain text: drop script/style/noscript
 * with their contents, turn block-level tags into newlines, strip the rest,
 * decode entities, and collapse whitespace (keeping paragraph breaks).
 */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/(?:p|div|section|article|header|footer|main|nav|li|ul|ol|tr|table|h[1-6]|blockquote|pre)>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ") // collapse horizontal whitespace
    .replace(/ *\n */g, "\n") // trim around line breaks
    .replace(/\n{3,}/g, "\n\n") // cap blank runs
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** Decode the common HTML entities plus numeric refs. `&amp;` is decoded last so `&amp;lt;` → `&lt;`. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, "&");
}

function codePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}
