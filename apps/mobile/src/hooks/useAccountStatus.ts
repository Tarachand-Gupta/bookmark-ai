import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../lib/auth";
import { AUTH_NAMESPACE } from "../lib/auth-config";
import { accountProbeFailure, type AccountStatus } from "../lib/account-readiness";
import { ForbiddenError, getMeta, ProvisioningError, SERVER_TARGET } from "../api";
import { usePreferences } from "../context/PreferencesContext";

export type { AccountStatus } from "../lib/account-readiness";
const POLL_MS = 2_000;
const POLL_MAX_MS = 60_000;
const REQUEST_MAX_MS = 15_000;
const readyKey = (userId: string) => `${AUTH_NAMESPACE}:account:${userId}:${SERVER_TARGET}:ready`;
export interface AccountStatusState { status: AccountStatus; recheck: () => void }

/** An unconfirmed account stays in setup until a successful protected meta read.
 * Returning accounts may paint their existing shell while checking the network. */
export function useAccountStatus(): AccountStatusState {
  const { isLoaded, userId } = useAuth();
  const { serverTarget } = usePreferences();
  const [state, setState] = useState<{ userId: string | null; status: AccountStatus }>({ userId: null, status: "checking" });
  const [attempt, setAttempt] = useState(0);
  const runId = useRef(0);
  const recheck = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    const id = ++runId.current;
    let cancelled = false, previouslyReady = false, sawProvisioning = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let deadline = Date.now() + POLL_MAX_MS;
    const current = () => !cancelled && id === runId.current;
    const settle = (status: AccountStatus) => { if (current()) setState({ userId, status }); };
    settle(!isLoaded ? "checking" : userId ? "provisioning" : "ok");
    if (!isLoaded || !userId) return () => { cancelled = true; };

    const startDeadline = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        if (poll) clearTimeout(poll);
        controller?.abort();
        settle("setup-error");
      }, Math.max(0, deadline - Date.now()));
    };
    const probe = async () => {
      controller = new AbortController();
      requestTimer = setTimeout(() => controller?.abort(), REQUEST_MAX_MS);
      try {
        await getMeta(controller.signal);
        if (!current()) return;
        if (deadlineTimer) clearTimeout(deadlineTimer);
        settle("ok");
        void AsyncStorage.setItem(readyKey(userId), "1").catch(() => {});
      } catch (error) {
        if (!current()) return;
        const kind = error instanceof ForbiddenError ? "forbidden" : error instanceof ProvisioningError ? "provisioning" : "unavailable";
        if (kind === "provisioning" && !sawProvisioning) {
          sawProvisioning = true;
          deadline = Date.now() + POLL_MAX_MS;
          startDeadline();
        }
        const status = accountProbeFailure(kind, previouslyReady, sawProvisioning, Date.now() >= deadline);
        settle(status);
        if (status === "provisioning") poll = setTimeout(() => void probe(), POLL_MS);
        else if (deadlineTimer) clearTimeout(deadlineTimer);
      } finally { if (requestTimer) clearTimeout(requestTimer); }
    };
    void AsyncStorage.getItem(readyKey(userId)).catch(() => null).then(seen => {
      if (!current()) return;
      previouslyReady = seen === "1";
      if (previouslyReady) settle("ok");
      else startDeadline();
      void probe();
    });
    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (requestTimer) clearTimeout(requestTimer);
      controller?.abort();
    };
  }, [isLoaded, userId, serverTarget, attempt]);
  return { status: state.userId === userId ? state.status : "checking", recheck };
}
