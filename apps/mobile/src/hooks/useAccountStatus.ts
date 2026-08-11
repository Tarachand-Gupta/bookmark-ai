import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/clerk-expo";
import { ForbiddenError, getMeta, ProvisioningError, SERVER_TARGET } from "../api";
import { usePreferences } from "../context/PreferencesContext";

/**
 * Where the signed-in account stands with the API, as far as the whole app is
 * concerned:
 *
 *  - `checking`      — the first probe is still in flight and we have no prior
 *                      evidence about this account (see the READY marker).
 *  - `ok`            — the API answered; the app is usable.
 *  - `provisioning`  — 503 `{code:"provisioning"}`: this account's own isolated
 *                      database is still being created (a fresh signup waits
 *                      ~10-15s). We poll until it's ready.
 *  - `forbidden`     — 403 `{code:"forbidden"}`: signed in fine, but this Clerk
 *                      identity isn't on the API's allowlist.
 *
 * Anything else (offline, 500, a timeout) resolves to `ok` ON PURPOSE: those are
 * transient / per-screen problems that each screen already reports in its own
 * error state with a retry. Only the two states that make the WHOLE app
 * unusable — and that no per-screen retry can fix — take over the screen.
 */
export type AccountStatus = "checking" | "ok" | "provisioning" | "forbidden";

/** Same 2s cadence as the web client's provisioning retry (PROVISION_RETRY_MS in
 * apps/web/hooks/use-library.ts) so both surfaces feel identical and neither
 * hammers the API while a Turso DB is being created. */
const POLL_MS = 2_000;

/**
 * How long we keep polling before giving up and letting the app through, mirroring
 * the web's PROVISION_MAX_MS. Provisioning a Turso DB takes ~10-15s; a minute of
 * 503s means something is actually wrong, and a permanently broken account must
 * not sit on "Setting up your account" forever — better to show the app, whose
 * screens have their own error states and pull-to-refresh.
 */
const POLL_MAX_MS = 60_000;

/**
 * "This account has reached a working API at least once" — per server target and
 * per Clerk user, so a dev build's marker never speaks for the prod target and a
 * second account on the same phone is judged on its own.
 *
 * Why persist it: the probe is one request, and blocking the first paint on it
 * would add its latency to EVERY cold start. With the marker we only block for a
 * user we've never seen succeed (i.e. a fresh signup — exactly the case that can
 * be provisioning), and returning users paint immediately while the probe runs
 * behind the already-rendered app.
 */
const readyKey = (userId: string) => `bookmark-ai:account-ready:${SERVER_TARGET}:${userId}`;

export interface AccountStatusState {
  status: AccountStatus;
  /** Re-run the probe now (the provisioning screen's manual retry). */
  recheck: () => void;
}

/**
 * One probe for the whole app: `GET /api/meta` (the cheapest authenticated read
 * that touches the tenant DB) classified into an AccountStatus.
 *
 * Mounted once above the tab shell (App.tsx). While the status is `provisioning`
 * or `forbidden` the Shell is NOT rendered — which is deliberately different
 * from the web's overlay: mobile keeps all five screens mounted, so leaving them
 * up would mean five screens each caching a failure behind the takeover. Not
 * rendering them means that when provisioning finishes the Shell mounts fresh
 * and every screen's first fetch already sees a ready database.
 */
export function useAccountStatus(): AccountStatusState {
  const { isLoaded, userId } = useAuth();
  const { serverTarget } = usePreferences();
  const [status, setStatus] = useState<AccountStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  // Guards stale async writes: only the newest probe run may touch state.
  const runId = useRef(0);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const id = ++runId.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Clerk hasn't restored the session yet: stay `checking` rather than
    // reporting `ok` on a not-yet-known user, which would let the tab shell
    // mount for a split second in front of the provisioning screen.
    if (!isLoaded) {
      setStatus("checking");
      return;
    }

    // Loaded, but no Clerk user (open/keyless mode): nothing to provision and
    // nothing to allowlist — never gate the app.
    if (!userId) {
      setStatus("ok");
      return;
    }

    const settle = (next: AccountStatus) => {
      if (cancelled || runId.current !== id) return;
      setStatus(next);
    };

    // When to stop polling and let the app through (see POLL_MAX_MS). Set on the
    // FIRST provisioning answer, so the window covers the wait itself rather than
    // the time Clerk took to hand us a user.
    let deadline = 0;
    /** True once this run has seen the server say "still provisioning". */
    let sawProvisioning = false;

    const probe = async (): Promise<void> => {
      try {
        await getMeta();
        settle("ok");
        // Remember the success so later launches paint without waiting.
        void AsyncStorage.setItem(readyKey(userId), "1").catch(() => {});
      } catch (err) {
        if (cancelled || runId.current !== id) return;
        if (err instanceof ForbiddenError) {
          settle("forbidden");
          return;
        }
        if (err instanceof ProvisioningError) {
          if (!sawProvisioning) {
            sawProvisioning = true;
            deadline = Date.now() + POLL_MAX_MS;
          }
          if (Date.now() < deadline) {
            settle("provisioning");
            // Keep polling — this IS the retry the provisioning screen promises.
            timer = setTimeout(() => void probe(), POLL_MS);
            return;
          }
          // Past the deadline: stop pretending it's a normal signup wait.
          settle("ok");
          return;
        }
        // Anything else (offline, 500, timeout). Mid-provisioning this is almost
        // always the API being briefly unreachable — a deploy, or a dev server
        // restarting — and dropping into a shell whose every screen will fail is
        // worse than waiting, so keep the provisioning screen up and keep polling
        // until the deadline. Outside that window it's a per-screen problem the
        // screens report themselves (see AccountStatus), so let the app through.
        if (sawProvisioning && Date.now() < deadline) {
          timer = setTimeout(() => void probe(), POLL_MS);
          return;
        }
        settle("ok");
      }
    };

    // Paint immediately for an account we've already seen working; only a
    // never-confirmed account holds the first frame on the probe.
    void AsyncStorage.getItem(readyKey(userId))
      .then((seen) => {
        if (cancelled || runId.current !== id) return;
        if (seen === "1") setStatus("ok");
      })
      .catch(() => {});

    void probe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isLoaded, userId, serverTarget, attempt]);

  return { status, recheck };
}
