import { storage } from "#imports";

/**
 * Self-readable diagnostics for the auth handoff (esp. Safari, which we can't
 * step through). `diag(scope, msg, data?)` keeps a small in-memory ring, mirrors
 * it to `storage.local` ("local:diagLog"), and fire-and-forget POSTs batches to
 * the LOCAL dev web server — Safari runs on the same Mac as the repo, and the
 * extension already holds `http://localhost/*` host permission, so the logs land
 * in `.dev-extension-log.ndjson` at the repo root with zero manual copy/paste.
 *
 * Every sink is best-effort: no dev server → the POST just fails and is dropped.
 * NEVER pass token/cookie VALUES here — log presence/length/status/error only.
 */

export interface DiagEntry {
  t: number;
  scope: string;
  msg: string;
  data?: unknown;
}

const RING_MAX = 300;
const FLUSH_DEBOUNCE_MS = 1000;

/** Hardcoded to the LOCAL dev server (NOT the configurable API base): the point
 * is to collect logs on the developer's machine even when the extension itself
 * is pointed at production for auth. A no-op when nothing listens there. */
const DEV_LOG_ENDPOINT = "http://localhost:3000/api/dev/extension-log";

const ring: DiagEntry[] = [];
let pending: DiagEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const diagLogItem = storage.defineItem<DiagEntry[]>("local:diagLog", { fallback: [] });

export function diag(scope: string, msg: string, data?: unknown): void {
  const entry: DiagEntry = { t: Date.now(), scope, msg };
  if (data !== undefined) entry.data = data;

  ring.push(entry);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  pending.push(entry);

  // Console mirror for a live inspector session.
  try {
    console.debug(`[diag:${scope}] ${msg}`, data ?? "");
  } catch {
    // ignore
  }
  // Storage mirror — survives a popup close / background restart.
  void diagLogItem.setValue(ring.slice()).catch(() => {});
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    await fetch(DEV_LOG_ENDPOINT, {
      method: "POST",
      // text/plain is CORS-safelisted → a "simple request" with NO preflight
      // (the dev route reads the body as JSON regardless of content-type). This
      // sidesteps the web middleware, which answers OPTIONS for /api routes
      // itself and never emits CORS for Safari's per-install extension origin.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    });
  } catch {
    // No dev server / offline — drop silently (still in the ring + storage).
  }
}

/** Snapshot of the current in-memory ring (for a manual dump if ever needed). */
export function diagRing(): DiagEntry[] {
  return ring.slice();
}
