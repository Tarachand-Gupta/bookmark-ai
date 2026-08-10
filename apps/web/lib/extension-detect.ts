/**
 * "Is the Bookmark AI extension installed?" — the detection plumbing behind
 * `useExtensionInstalled` (components/library/extension-cta.tsx), which is what
 * hides the sidebar's "Get the extension" card.
 *
 * There is no single API for this, so we run TWO channels and take the first
 * positive answer:
 *
 * 1. **DOM marker** (Firefox + Safari) — those builds inject a content script
 *    that stamps `data-bookmark-ai-extension="1"` on `<html>`. Synchronous to
 *    read, but the script lands at document_idle, i.e. possibly AFTER we mount —
 *    hence the MutationObserver as well as the immediate read.
 * 2. **`externally_connectable` ping** (Chrome/Edge/Arc) — messages the
 *    background directly. Firefox exposes no page→extension messaging at all
 *    (Firefox bug 1319168), so there this is simply absent.
 *
 * Plus a localStorage memo of the last positive answer, because BOTH channels
 * can be slow on a cold start: an MV3 service worker has to WAKE before it can
 * answer a ping (well past a single 1.5s attempt on a loaded machine), and a
 * content script runs when the page settles. Without the memo a slow wake shows
 * the install card to a user who already installed; with it the card stays
 * hidden while we re-verify, and only a run that exhausts EVERY channel clears
 * the memo and brings the card back.
 */

/** Published extension ids per build target — each browser exposes exactly one,
 * so we ping all three and take the first that answers. */
export const EXTENSION_IDS = [
  "ffhbgpgebpmofjkehpjcemepbgcmoelp", // prod
  "ljlfmaknohecakpdolffabmjdfikfjed", // dev
  "joillpelifndeefomeimoomlgoimbkei", // local
];

/** Message the background answers `{ ok: true }` to. MIRRORS
 * `BOOKMARK_AI_PING` in apps/extension/lib/messages.ts. */
export const PING_MESSAGE_TYPE = "BOOKMARK_AI_PING";

/** `<html>` attribute the Firefox/Safari content script stamps. MIRRORS
 * `EXTENSION_MARKER_ATTR` in apps/extension/lib/extension-marker.ts — rename one
 * and detection on those browsers silently goes dark. */
export const EXTENSION_MARKER_ATTR = "data-bookmark-ai-extension";

/** Memo of the last confirmed install, so the card can hide on the FIRST paint
 * of a later visit instead of after a round-trip. */
export const INSTALLED_CACHE_KEY = "bkm-ext-installed";

/** Budget for ONE ping attempt. A cold MV3 worker frequently needs more than
 * this — that's what the retries are for, not a longer single wait (a fast
 * "yes" should stay fast). */
export const PING_ATTEMPT_TIMEOUT_MS = 1500;

/** Delay BEFORE each attempt. Three attempts spaced out over the budget below:
 * 0 + 1.5s(timeout) + 1s + 1.5s + 2.5s + 1.5s ≈ 8s worst case. */
export const PING_ATTEMPT_DELAYS_MS = [0, 1000, 2500];

/** Total time we'll spend before concluding "not installed". The marker
 * observer runs for this whole window, so a late content script still wins. */
export const DETECT_BUDGET_MS = 8000;

/** Breadcrumbs for "the card won't hide" reports — `console.debug` so they're
 * off by default in devtools (Verbose) and never in the user's face. */
export function detectLog(message: string, data?: unknown): void {
  if (data === undefined) console.debug(`[ext-detect] ${message}`);
  else console.debug(`[ext-detect] ${message}`, data);
}

/* ── localStorage memo ────────────────────────────────────────────────────── */

/** Read on the client only, and never from a render — the server has no
 * `localStorage`, so using this during render would hydrate-mismatch. */
export function readInstalledMemo(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_CACHE_KEY) === "1";
  } catch {
    // Private-mode Safari / storage disabled — treat as "no memo".
    return false;
  }
}

export function writeInstalledMemo(installed: boolean): void {
  try {
    if (installed) window.localStorage.setItem(INSTALLED_CACHE_KEY, "1");
    else window.localStorage.removeItem(INSTALLED_CACHE_KEY);
  } catch {
    // Ignore: the memo is an optimization, never a source of truth.
  }
}

/* ── Channel 1: DOM marker ────────────────────────────────────────────────── */

export function hasExtensionMarker(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement?.getAttribute(EXTENSION_MARKER_ATTR) === "1"
  );
}

/**
 * Call `onFound` if/when the marker attribute appears. Returns a stop function;
 * the observer is scoped to the one attribute on `<html>`, so it costs nothing
 * while nothing sets it.
 */
export function observeExtensionMarker(onFound: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const observer = new MutationObserver(() => {
    if (hasExtensionMarker()) onFound();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [EXTENSION_MARKER_ATTR],
  });
  return () => observer.disconnect();
}

/* ── Channel 2: Chrome external message ping ──────────────────────────────── */

interface ChromeRuntimeLike {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  /** Read (any access clears it) inside the callback to swallow the "Receiving
   * end does not exist" error Chrome sets when no extension answers. */
  lastError?: unknown;
}

function chromeRuntime(): ChromeRuntimeLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { chrome?: { runtime?: ChromeRuntimeLike } }).chrome?.runtime;
}

/** Whether this browser/origin even has the ping channel. Chrome only injects
 * `chrome.runtime` into pages matched by an installed extension's
 * `externally_connectable`, so `false` here is genuinely inconclusive: it means
 * "no Chromium ping available", not "no extension". */
export function canPingExtension(): boolean {
  return typeof chromeRuntime()?.sendMessage === "function";
}

/** ONE round: ping every known id in parallel, first `{ok:true}` wins. Resolves
 * `false` on timeout — most often a service worker that hasn't woken yet. */
export function pingExtensionOnce(timeoutMs = PING_ATTEMPT_TIMEOUT_MS): Promise<boolean> {
  const runtime = chromeRuntime();
  if (!runtime?.sendMessage) return Promise.resolve(false);
  // Bound up front: `sendMessage` is optional, so its narrowing doesn't survive
  // into the callbacks below — and an unbound call would be an illegal
  // invocation in Chrome.
  const send = runtime.sendMessage.bind(runtime);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    for (const id of EXTENSION_IDS) {
      try {
        send(id, { type: PING_MESSAGE_TYPE }, (response) => {
          void runtime.lastError; // swallow "Receiving end does not exist"
          if (response && (response as { ok?: boolean }).ok) finish(true);
        });
      } catch {
        // sendMessage can throw synchronously (e.g. a malformed id) — ignore and
        // let the other ids / the timeout decide.
      }
    }
  });
}

/**
 * Ping with backoff. THE fix for the original bug: a single attempt raced a
 * cold service-worker wake and lost, then never tried again for the lifetime of
 * the mount. Gives up early when `isCancelled()` goes true (unmount, or the
 * marker channel already answered).
 */
export async function pingExtensionWithRetries(isCancelled: () => boolean): Promise<boolean> {
  for (const [index, delay] of PING_ATTEMPT_DELAYS_MS.entries()) {
    if (delay > 0) await sleep(delay);
    if (isCancelled()) return false;
    const ok = await pingExtensionOnce();
    detectLog(`ping attempt ${index + 1}/${PING_ATTEMPT_DELAYS_MS.length}`, { ok });
    if (ok) return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
