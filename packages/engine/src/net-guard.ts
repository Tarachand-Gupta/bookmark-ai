import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";

/**
 * Shared server-side fetch hardening for every engine feature that pulls a
 * user-supplied URL (Open Graph scraping, the agent's `fetchUrl` tool, …).
 *
 * The policy: only http/https on default web ports, every hostname is
 * DNS-resolved and rejected if it maps to a private/reserved address, redirects
 * are followed manually and re-validated per hop, and bodies are read with a
 * hard byte cap. Extracted verbatim from og.ts so all callers share one
 * implementation.
 *
 * SECURITY — DNS-rebind (TOCTOU) mitigation: validation and the actual TCP
 * connection are pinned to the SAME resolved IP. `assertSafeUrl` resolves the
 * host, validates every address, and returns the chosen IP; `followRedirects`
 * then dials that exact IP via an undici dispatcher whose `connect.lookup` can
 * only return the pre-validated address — undici never re-resolves, so a
 * rebinding resolver (TTL=0) cannot swap in 169.254.169.254 / 127.0.0.1 / an
 * internal IP between the check and the connect. The original hostname stays in
 * the URL, so the Host header and TLS SNI/certificate check are unaffected.
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; BookmarkAI/0.1; +https://github.com/bookmark-ai) AppleWebKit/537.36";

/** SECURITY: hard cap on a single DNS resolution so a slow/hostile resolver can't stall a request. */
const DNS_TIMEOUT_MS = 3_000;

export interface FollowOptions {
  /** `accept` request header (defaults to accepting any content type). */
  accept?: string;
  /** `user-agent` request header (defaults to {@link DEFAULT_USER_AGENT}). */
  userAgent?: string;
  /** Total wall-clock budget in ms for the whole redirect chain (defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Max redirect hops to follow before bailing (defaults to {@link DEFAULT_MAX_REDIRECTS}). */
  maxRedirects?: number;
  /**
   * Extra request headers (e.g. `authorization`, `x-api-key`, `x-goog-api-key`)
   * sent on EVERY hop. Lets a guarded caller (the AI-provider "test connection")
   * carry auth while keeping the SSRF guard's IP-pinning + per-hop revalidation.
   * SECURITY: these ride along to redirect targets too, so only use with fixed
   * hosts or hosts you've accepted may see the header after a same-policy hop.
   */
  headers?: Record<string, string | undefined>;
}

/**
 * A URL that passed {@link assertSafeUrl}, plus the single IP address the
 * connection MUST be pinned to. SECURITY: pinning to this exact address is what
 * closes the DNS-rebind TOCTOU hole (see the module header).
 */
export interface SafeTarget {
  /** The validated URL — keeps the original hostname for the Host header + TLS SNI. */
  url: URL;
  /** The pre-validated IP the socket is locked to; undici must not re-resolve. */
  address: string;
  family: 4 | 6;
}

/**
 * SSRF-guarded fetch that follows redirects manually, re-validating every hop
 * against {@link assertSafeUrl}. Returns the final non-redirect `Response` with
 * its body still unread (the caller must consume or cancel it), or `null` when
 * the redirect budget is exceeded. Throws only on transport errors / timeouts,
 * which callers treat as graceful degradation.
 */
export async function followRedirects(
  startUrl: string,
  opts: FollowOptions = {},
): Promise<Response | null> {
  const accept = opts.accept ?? "*/*";
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  // SECURITY (redirect-timeout budget): one wall-clock deadline for the WHOLE
  // chain. Each hop's AbortSignal derives from the REMAINING time, so a run of
  // slow redirects can't each reset a fresh full timeout and multiply the wait.
  const deadline = Date.now() + timeoutMs;

  let current = startUrl;
  for (let redirects = 0; ; redirects++) {
    // SECURITY (DNS-rebind TOCTOU): re-validate every hop AND capture the exact
    // IP it resolved to, then pin the connection to that IP below.
    const target = await assertSafeUrl(current);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out following redirects for ${startUrl}`);

    // SECURITY (DNS-rebind TOCTOU): a per-hop dispatcher whose connect.lookup can
    // only return the pre-validated IP, so undici never re-resolves the host.
    const dispatcher = pinnedDispatcher(target.address, target.family);
    let res: Response;
    try {
      // Node's global fetch IS undici and honors a per-request `dispatcher`, but
      // the `RequestInit` type differs by context (undici-types under Node vs DOM
      // under Next), so build the init untyped and cast through `unknown` — the
      // runtime object carries the dispatcher either way.
      const init = {
        headers: { "user-agent": userAgent, accept, ...opts.headers },
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
        dispatcher,
      };
      res = await fetch(target.url, init as unknown as RequestInit);
    } catch (err) {
      // Transport error / timeout: free the pinned dispatcher, then rethrow.
      await dispatcher.close().catch(() => {});
      throw err;
    }

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      await dispatcher.close().catch(() => {}); // intermediate hop — release it now
      if (redirects >= maxRedirects) return null;
      current = new URL(location, target.url).toString();
      continue;
    }
    // Final response: the caller still has to read the body, so this hop's
    // dispatcher must outlive the function. Its keep-alive is set to close idle
    // sockets almost immediately, so it's reclaimed once the body is consumed.
    return res;
  }
}

/**
 * Build a single-use undici dispatcher whose DNS resolution is fixed to one
 * pre-validated address. SECURITY: this is what actually pins the socket —
 * global `fetch` connects through this dispatcher instead of resolving the
 * hostname again, so the address that was validated is the address dialed.
 */
function pinnedDispatcher(address: string, family: 4 | 6): Agent {
  const pinnedLookup: LookupFunction = (_hostname, options, cb) => {
    // Ignore the hostname entirely: only the pre-validated IP may ever be used.
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  return new Agent({
    connect: { lookup: pinnedLookup },
    // Close idle sockets almost immediately so the per-request dispatcher is
    // reclaimed shortly after the body is consumed (the final hop's dispatcher
    // can't be .close()d here because the caller still needs to read the body).
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  });
}

/**
 * Validate a URL against the SSRF policy. Returns the parsed URL AND the single
 * pre-validated IP the caller must pin the connection to (see {@link SafeTarget}
 * and {@link followRedirects}). Throws if blocked.
 *
 * SECURITY: resolving here and pinning the returned address at connect time is
 * what eliminates the DNS-rebind TOCTOU — the address checked is the exact
 * address dialed, so a TTL=0 rebinding resolver can't return a public IP to this
 * check and 169.254.169.254 / 127.0.0.1 / an internal IP to the real socket.
 */
export async function assertSafeUrl(raw: string): Promise<SafeTarget> {
  const url = new URL(raw); // throws on malformed input → caught upstream
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`blocked protocol: ${url.protocol}`);
  }
  // Only default (empty) or the standard web ports.
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new Error(`blocked port: ${url.port}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[/, "").replace(/\]$/, ""); // strip IPv6 literal brackets
  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare === "local" ||
    bare.endsWith(".local")
  ) {
    throw new Error(`blocked host: ${bare}`);
  }
  // Resolve every address (lookup returns the literal itself for IP hosts) and
  // reject if ANY of them is private/reserved. SECURITY: the lookup is bounded
  // by a hard timeout so a slow/hostile resolver can't stall the request.
  const addresses = await lookupWithTimeout(bare);
  if (addresses.length === 0) throw new Error(`no address resolved for ${bare}`);
  for (const { address, family } of addresses) {
    const blocked = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
    if (blocked) throw new Error(`blocked address ${address} for ${bare}`);
  }
  // Every resolved address passed, so pinning any one is safe; pin the first.
  // This is the exact address the connection is locked to (see SafeTarget).
  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

/**
 * SECURITY (DNS timeout): resolve `host` with a hard wall-clock cap so a slow or
 * deliberately-stalling resolver can't hang the request indefinitely.
 */
async function lookupWithTimeout(host: string): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DNS lookup timed out for ${host}`)),
      DNS_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([lookup(host, { all: true }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** True for private/reserved/loopback/link-local/broadcast IPv4 (or unparseable). */
export function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split(".");
  if (octets.length !== 4) return true;
  const nums = octets.map((o) => Number(o));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = nums[0] ?? -1;
  const b = nums[1] ?? -1;
  const c = nums[2] ?? -1;
  const d = nums[3] ?? -1;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  // SECURITY (finding #2): additional reserved / non-routable ranges an SSRF can abuse.
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT shared address space
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1 (documentation)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 240) return true; // 240.0.0.0/4 reserved / future use (subsumes 255.255.255.255)
  return false;
}

/** True for loopback/unspecified/unique-local/link-local IPv6 (incl. IPv4-mapped). */
export function isBlockedIPv6(ip: string): boolean {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr === "::" || addr === "::1") return true;

  // IPv4-mapped ::ffff:a.b.c.d (dotted) — check the embedded IPv4.
  const dottedV4 = addr.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1];
  if (dottedV4) return isBlockedIPv4(dottedV4);

  // IPv4-mapped ::ffff:hhhh:hhhh (hex) — reconstruct and check the IPv4.
  const hex = addr.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  const hexHi = hex?.[1];
  const hexLo = hex?.[2];
  if (hexHi && hexLo) {
    const hi = parseInt(hexHi, 16);
    const lo = parseInt(hexLo, 16);
    return isBlockedIPv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }

  // SECURITY (finding #3): NAT64 well-known prefix 64:ff9b::/96 (compressed
  // `64:ff9b::` and non-compressed `64:ff9b:0:0:0:0:` forms). DNS64/NAT64
  // gateways translate these to the embedded IPv4 in the trailing 32 bits, so
  // decode that IPv4 and run it through isBlockedIPv4.
  if (/^64:ff9b:(?::|0:0:0:0:)/.test(addr)) {
    const nat64Dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1];
    if (nat64Dotted) return isBlockedIPv4(nat64Dotted);
    const nat64Hex = addr.match(/:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const nHi = nat64Hex?.[1];
    const nLo = nat64Hex?.[2];
    if (nHi && nLo) {
      const hi = parseInt(nHi, 16);
      const lo = parseInt(nLo, 16);
      return isBlockedIPv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
    }
    return true; // NAT64 prefix but an unparseable tail → block conservatively
  }

  const head = addr.startsWith("::") ? "0" : addr.split(":")[0] || "0";
  const first = parseInt(head, 16);
  if (Number.isNaN(first)) return true; // unparseable → block
  const top8 = (first >> 8) & 0xff;
  if (top8 === 0xfc || top8 === 0xfd) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** Stream the body, aborting once maxBytes is reached, and decode as UTF-8. */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const buf = Buffer.concat(chunks);
  return (buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf).toString("utf8");
}
