import { bridgeRequestSchema, type BridgeRequest, type NewTabWizardData } from "@bookmark-ai/types";
import { requestApiProxy } from "../../lib/messages";

/**
 * The newtab page's bridge (docs/features/newtab-canvas.md §4.4/§4.5) — the
 * ONLY channel out of the sandboxed iframe. The iframe posts one of the fixed
 * vocabulary messages; this validates it (zod — malformed drops silently),
 * translates it into an authed /api/* call (proxied through the background,
 * which holds the auth ladder), and replies. The iframe never sees a token,
 * never sees chrome.*, only the JSON we choose to return.
 *
 * SECURITY invariants (never weaken — §5):
 *  - event.source must be OUR iframe's contentWindow.
 *  - event.origin must be "null" (the opaque origin the `sandbox` attribute —
 *    WITHOUT allow-same-origin — gives the iframe).
 *  - No write message types exist. `openUrl` is the one action and the URL is
 *    scheme-validated before the parent opens it in ITS chrome.
 */

/** Replies are cached per message TYPE so the chat popover can snapshot "what
 *  is on the screen" for the readActiveTemplate tool (§4.8). Cap each entry's
 *  serialized size — renderedData rides inside every chat request. */
const RENDERED_CACHE_CAP = 24_000;

/** One proxied GET to the JSON API: throws {status} sentinel-shaped errors. */
async function proxyGetJson(path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await requestApiProxy("GET", path);
  let body: unknown = {};
  if (res.bodyJson) {
    try {
      body = JSON.parse(res.bodyJson);
    } catch {
      body = {};
    }
  }
  return { ok: res.ok && res.status >= 200 && res.status < 300, status: res.status, body };
}

export interface BridgeHandle {
  detach(): void;
  /** The current snapshot of what the iframe last rendered (untrusted data). */
  getRenderedSnapshot(): Record<string, unknown>;
}

/** Structural minimums so unit tests can drive the bridge without a DOM. The
 *  real iframe and `window` satisfy these; tests inject fakes. */
export interface BridgeIframeLike {
  contentWindow: { postMessage(data: unknown, targetOrigin: string): void } | null;
}
export interface BridgeListenTarget {
  addEventListener(type: "message", fn: (event: MessageEvent) => unknown): unknown;
  removeEventListener(type: "message", fn: (event: MessageEvent) => unknown): unknown;
}

export function attachBridge(opts: {
  iframe: BridgeIframeLike;
  /** Wizard cache provider (cold-open prefetched by the app; lazily fetched
   *  here on first use). Serves the wizard-feature message types. */
  getWizard: () => Promise<NewTabWizardData>;
  onOpenUrl: (url: string) => void;
  /** Event source — defaults to the page's window; tests inject a fake. */
  listenOn?: BridgeListenTarget;
}): BridgeHandle {
  const rendered = new Map<string, unknown>();
  const listenOn: BridgeListenTarget = opts.listenOn ?? window;

  function reply(id: string, body: Record<string, unknown>): void {
    try {
      opts.iframe.contentWindow?.postMessage({ id, ...body }, "*");
    } catch {
      // Iframe navigated away mid-flight — nothing to do.
    }
  }

  function recordRendered(type: string, data: unknown): void {
    try {
      const size = JSON.stringify(data)?.length ?? 0;
      if (size <= RENDERED_CACHE_CAP) rendered.set(type, data);
    } catch {
      // unserializable — leave the cache as it was
    }
  }

  async function handle(req: BridgeRequest): Promise<void> {
    switch (req.type) {
      case "ready": {
        reply(req.id, { ok: true, data: { bridge: "bookmark-ai-newtab" } });
        return;
      }
      case "openUrl": {
        // The bridge's only action. Scheme-gated before a tab is ever created.
        if (/^https?:\/\//i.test(req.url)) opts.onOpenUrl(req.url);
        reply(req.id, { ok: true });
        return;
      }
      case "search": {
        const out = await proxyGetJson(
          `/api/search?q=${encodeURIComponent(req.q)}&mode=${req.mode}&limit=${req.limit}`,
        );
        reply(
          req.id,
          out.ok
            ? { ok: true, data: out.body }
            : { ok: false, error: `Search failed (${out.status})` },
        );
        if (out.ok) recordRendered("search", out.body);
        return;
      }
      case "listBookmarks": {
        const params = new URLSearchParams({ limit: String(req.limit), offset: String(req.offset) });
        if (req.category) params.set("category", req.category);
        if (req.tag) params.set("tag", req.tag);
        if (req.day) params.set("day", req.day);
        const out = await proxyGetJson(`/api/bookmarks?${params}`);
        reply(
          req.id,
          out.ok
            ? { ok: true, data: out.body }
            : { ok: false, error: `List failed (${out.status})` },
        );
        if (out.ok) recordRendered("listBookmarks", out.body);
        return;
      }
      case "getMeta":
      case "listSessions": {
        const path = req.type === "getMeta" ? "/api/meta" : "/api/sessions";
        const out = await proxyGetJson(path);
        if (!out.ok) {
          reply(req.id, { ok: false, error: `Request failed (${out.status})` });
          return;
        }
        const raw = out.body as Record<string, unknown>;
        let data: unknown = raw;
        if (req.type === "listSessions") {
          const q = (req.query ?? "").trim().toLowerCase();
          const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
          const filtered = q
            ? sessions.filter((s) => JSON.stringify(s).toLowerCase().includes(q))
            : sessions;
          data = { sessions: filtered.slice(0, req.limit) };
        }
        recordRendered(req.type, data);
        reply(req.id, { ok: true, data });
        return;
      }
      // Wizard features — served from the cached one-hop bundle (§4.5.1).
      case "getWizard":
      case "getFavorites":
      case "getMostUsed":
      case "getTimeSpent":
      case "continueWhereYouLeft":
      case "listLiveTabs": {
        try {
          const wizard = await opts.getWizard();
          const section: Record<typeof req.type, unknown> = {
            getWizard: wizard,
            getFavorites: wizard.favorites,
            getMostUsed: wizard.mostUsed,
            getTimeSpent: wizard.timeSpent,
            continueWhereYouLeft: wizard.continueWhereYouLeft,
            listLiveTabs: wizard.workingOn,
          };
          recordRendered(req.type, section[req.type]);
          reply(req.id, { ok: true, data: section[req.type] });
        } catch (err) {
          reply(req.id, { ok: false, error: (err as Error).message });
        }
        return;
      }
    }
  }

  const listener = (event: MessageEvent) => {
    if (event.source !== opts.iframe.contentWindow) return;
    // The opaque-origin sandbox posts with origin "null". Anything else is not
    // our iframe — drop it without replying (a reply would leak the channel's
    // existence to a rogue frame).
    if (event.origin !== "null") return;
    const parsed = bridgeRequestSchema.safeParse(event.data);
    if (!parsed.success) return;
    void handle(parsed.data);
  };
  listenOn.addEventListener("message", listener);

  return {
    detach: () => listenOn.removeEventListener("message", listener),
    getRenderedSnapshot: () => Object.fromEntries(rendered),
  };
}
