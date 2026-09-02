/**
 * Bounded fetch — THE fix for the wedged-worker outage (2026-09-02).
 *
 * Extension fetches had no timeout anywhere. A network change mid-request
 * (laptop hopping networks) can stall a fetch indefinitely; the promise never
 * settles, so everything serialized behind it wedges too: the live
 * checkpoint's `flushing` guard, the auth single-flight in auth-refresh.ts.
 * Because tab events keep the MV3 worker alive while the user browses, the
 * wedge survives for HOURS — live pushes silently stopped all day while the
 * popup still said "sharing" (server logs showed the pushes simply never
 * arrived). A bounded fetch makes every promise settle, which lets the
 * existing backoff/retry machinery actually run.
 */

/** Generous enough for a slow mobile link; far below "wedged forever". */
export const FETCH_TIMEOUT_MS = 20_000;

/** `fetch` that ALWAYS settles: rejects with AbortError after `timeoutMs`.
 * Composes with a caller-provided signal when one exists. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeout = timeoutSignal(timeoutMs);
  const signal = init.signal
    ? combineSignals(init.signal as AbortSignal, timeout)
    : timeout;
  return fetch(url, { ...init, signal });
}

function timeoutSignal(ms: number): AbortSignal {
  // AbortSignal.timeout exists everywhere we ship (Chrome 103+, Firefox 100+,
  // Safari 16+), but a manual fallback costs three lines and can't regress.
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
  return controller.signal;
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const controller = new AbortController();
  const forward = (signal: AbortSignal) => {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  };
  forward(a);
  forward(b);
  return controller.signal;
}
