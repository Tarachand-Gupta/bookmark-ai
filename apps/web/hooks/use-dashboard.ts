"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardResponse } from "@bookmark-ai/types";
import { ForbiddenError, getDashboard, ProvisioningError } from "@/lib/api";
import { DASHBOARD_SNAPSHOT_KEY, dashboardRetryDelayMs } from "@/lib/dashboard";
import { detectSource } from "@/lib/detect";

/**
 * The dashboard's one fetch, with a hand-rolled stale-while-revalidate cache
 * (docs/features/dashboard.md principle 4: perceived speed is a feature).
 *
 * On a revisit the last payload is read out of localStorage and rendered
 * IMMEDIATELY (`stale: true`), while a fresh request runs in the background — so
 * the landing page paints content, not skeletons, from the first frame. Only a
 * genuinely first visit (no snapshot) sees skeletons.
 *
 * The snapshot is keyed by Clerk user id: a shared browser must never flash one
 * account's bookmarks at another, and every write prunes snapshots belonging to
 * other users for the same reason.
 */

/** Keep in step with use-library.ts: the same 2s re-fire cadence behind the same
 * branded provisioning screen, so Home and the library never poll at two speeds. */
const PROVISION_RETRY_MS = 2_000;
const PROVISION_MAX_MS = 60_000;

export interface DashboardState {
  data: DashboardResponse | null;
  /** `data` came from the cached snapshot and a fresh fetch is still running. */
  stale: boolean;
  loading: boolean;
  error: string | null;
  /** The account's DB is still being created (see use-library's AsyncState). */
  provisioning: boolean;
  /** Signed in, but not on the API allowlist (403). */
  forbidden: boolean;
  refresh: () => void;
}

function snapshotKey(userKey: string): string {
  return `${DASHBOARD_SNAPSHOT_KEY}:${userKey}`;
}

function readSnapshot(userKey: string): DashboardResponse | null {
  try {
    const raw = window.localStorage.getItem(snapshotKey(userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardResponse;
    // Shape check only — a stale snapshot from an older build must degrade to
    // "no snapshot", never crash the landing page.
    return Array.isArray(parsed?.recentBookmarks) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSnapshot(userKey: string, data: DashboardResponse): void {
  try {
    const key = snapshotKey(userKey);
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${DASHBOARD_SNAPSHOT_KEY}:`) && k !== key) {
        window.localStorage.removeItem(k);
      }
    }
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Quota exceeded / private mode — the cache is an optimization, not state.
  }
}

function delay(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * @param userKey Clerk user id ("anon" in keyless/self-host mode) — namespaces
 * the snapshot. Pass `null` while Clerk is still resolving: the hook then stays
 * in `loading` and fetches NOTHING, because it cannot know which account's
 * snapshot to read yet and firing now would mean two requests per landing (one
 * under the placeholder key, one under the real one).
 */
export function useDashboard(userKey: string | null): DashboardState {
  const [state, setState] = useState<Omit<DashboardState, "refresh">>({
    data: null,
    stale: false,
    loading: true,
    error: null,
    provisioning: false,
    forbidden: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (userKey === null) return; // identity unresolved — see the doc comment
    const controller = new AbortController();

    // Read the snapshot HERE, not in a render/initializer: the server has no
    // localStorage, so deciding what to draw from it during render would
    // hydrate-mismatch the whole page.
    const cached = readSnapshot(userKey);
    if (cached) {
      setState({
        data: cached,
        stale: true,
        loading: true,
        error: null,
        provisioning: false,
        forbidden: false,
      });
    } else {
      setState((s) => ({ ...s, loading: true, error: null, provisioning: false, forbidden: false }));
    }

    void (async () => {
      // Device class is only used for `otherDeviceBookmarks`; detect it here
      // (inside the effect) because it needs `navigator`.
      const device = detectSource().device;
      const deadline = Date.now() + PROVISION_MAX_MS;
      // Retries spent on failures that are NOT provisioning (see
      // dashboardRetryDelayMs). A brand-new signup can get a 500 from a tenant
      // whose DB creation threw, or a 401 from a session token that wasn't
      // minted yet — both clear on their own within a second or two, and both
      // used to end the load right there, leaving the page blank.
      let errorAttempts = 0;
      for (;;) {
        try {
          const data = await getDashboard(device, controller.signal);
          if (controller.signal.aborted) return;
          writeSnapshot(userKey, data);
          setState({
            data,
            stale: false,
            loading: false,
            error: null,
            provisioning: false,
            forbidden: false,
          });
          return;
        } catch (err) {
          const e = err as Error;
          if (e.name === "AbortError") return;
          if (e instanceof ProvisioningError && Date.now() < deadline) {
            setState((s) => ({ ...s, loading: true, error: null, provisioning: true }));
            if (!(await delay(PROVISION_RETRY_MS, controller.signal))) return;
            continue;
          }
          // Anything else, on a load that has NOTHING to fall back on: retry a
          // few times with backoff before giving up. `forbidden` is excluded —
          // no amount of retrying makes an unauthorized account authorized.
          if (!(e instanceof ForbiddenError)) {
            const backoff = dashboardRetryDelayMs(errorAttempts + 1);
            if (backoff !== null) {
              errorAttempts += 1;
              setState((s) => ({ ...s, loading: true, error: null, provisioning: false }));
              if (!(await delay(backoff, controller.signal))) return;
              continue;
            }
          }
          // Keep any cached data on screen — a dashboard that already painted
          // must not collapse into an error card because a revalidate failed.
          setState((s) => ({
            ...s,
            stale: s.data !== null,
            loading: false,
            error: e.message,
            provisioning: false,
            forbidden: e instanceof ForbiddenError,
          }));
          return;
        }
      }
    })();

    return () => controller.abort();
  }, [userKey, refreshKey]);

  return { ...state, refresh };
}
