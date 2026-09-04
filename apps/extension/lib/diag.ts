import { storage } from "#imports";
import { fetchWithTimeout } from "./net";

/**
 * Self-readable diagnostics for the auth handoff (esp. Safari, which we can't
 * step through). `diag(scope, msg, data?)` keeps a small in-memory ring, mirrors
 * it to `storage.local` ("local:diagLog"), and — in NON-PRODUCTION builds only —
 * fire-and-forget POSTs batches to the LOCAL dev web server: Safari runs on the
 * same Mac as the repo, and the extension already holds `http://localhost/*`
 * host permission, so the logs land in `.dev-extension-log.ndjson` at the repo
 * root with zero manual copy/paste.
 *
 * The network sink is gated on the BUILD MODE (`development` = local target,
 * `dev-remote` = dev target). A production build (`chrome-mv3`, `firefox-mv2`,
 * `safari-mv3`) must never fire requests at whatever a user happens to run on
 * localhost:3000 — Vite inlines `import.meta.env.MODE`, so in production the
 * endpoint folds to `null` and the URL literal is gone from the bundle entirely.
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
 * is to collect logs on the developer's machine even when a dev-target build is
 * pointed at a remote deployment for auth. `null` in every other mode — the
 * comparison is against the inlined build mode on purpose (no helper function),
 * so a production bundle contains neither the branch nor the URL. Exported for
 * the unit test that pins that contract. */
export const DEV_LOG_ENDPOINT: string | null =
  import.meta.env.MODE === "development" || import.meta.env.MODE === "dev-remote"
    ? "http://localhost:3000/api/dev/extension-log"
    : null;

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
  // Production builds: ring + storage only, no network — don't even queue.
  if (!DEV_LOG_ENDPOINT) return;
  // The background may be an EVENT page (Safari) that gets torn down within
  // milliseconds of answering a message — a debounced flush would lose every
  // entry. Flush bg-scope entries immediately; everything else can batch.
  if (scope === "bg") {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (!DEV_LOG_ENDPOINT || pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    // Bounded like every other fetch in the extension — nothing awaits this, but
    // an unbounded stall still pins the batch and its promise for the lifetime of
    // the (persistent, on Firefox) background context.
    await fetchWithTimeout(DEV_LOG_ENDPOINT, {
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
