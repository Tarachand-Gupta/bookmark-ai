import { bridgeRequestSchema, type BridgeRequest, type NewTabWizardData } from "@bookmark-ai/types";
import { authFetch, getApiBaseUrl } from "@/lib/api";

/**
 * The newtab page's bridge (docs/features/newtab-canvas.md §4.4/§4.5) — the
 * ONLY channel out of the sandboxed iframe. The iframe posts one of the fixed
 * vocabulary messages; this validates it (zod — malformed drops silently),
 * translates it into an authed /api/* call, and replies. The iframe never sees
 * a token, never sees chrome.*, only the JSON we choose to return.
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

export interface BridgeHandle {
  detach(): void;
  /** The current snapshot of what the iframe last rendered (untrusted data). */
  getRenderedSnapshot(): Record<string, unknown>;
}

export function attachBridge(opts: {
  iframe: HTMLIFrameElement;
  /** Wizard cache provider (cold-open prefetched by the app; lazily fetched
   *  here on first use). Serves the wizard-feature message types. */
  getWizard: () => Promise<NewTabWizardData>;
  onOpenUrl: (url: string) => void;
}): BridgeHandle {
  const rendered = new Map<string, unknown>();

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
        const base = await getApiBaseUrl();
        const res = await authFetch(
          `${base}/api/search?q=${encodeURIComponent(req.q)}&mode=${req.mode}&limit=${req.limit}`,
          { headers: { accept: "application/json" } },
        );
        const data = res.ok ? await res.json() : { error: `Search failed (${res.status})` };
        reply(req.id, res.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string }).error });
        if (res.ok) recordRendered("search", data);
        return;
      }
      case "listBookmarks": {
        const params = new URLSearchParams({ limit: String(req.limit), offset: String(req.offset) });
        if (req.category) params.set("category", req.category);
        if (req.tag) params.set("tag", req.tag);
        if (req.day) params.set("day", req.day);
        const base = await getApiBaseUrl();
        const res = await authFetch(`${base}/api/bookmarks?${params}`, {
          headers: { accept: "application/json" },
        });
        const data = res.ok ? await res.json() : { error: `List failed (${res.status})` };
        reply(req.id, res.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string }).error });
        if (res.ok) recordRendered("listBookmarks", data);
        return;
      }
      case "getMeta":
      case "listSessions": {
        const path = req.type === "getMeta" ? "/api/meta" : "/api/sessions";
        const base = await getApiBaseUrl();
        const res = await authFetch(`${base}${path}`, { headers: { accept: "application/json" } });
        const raw = res.ok ? ((await res.json()) as Record<string, unknown>) : null;
        if (!res.ok || !raw) {
          reply(req.id, { ok: false, error: `Request failed` });
          return;
        }
        let data = raw;
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
  window.addEventListener("message", listener);

  return {
    detach: () => window.removeEventListener("message", listener),
    getRenderedSnapshot: () => Object.fromEntries(rendered),
  };
}
