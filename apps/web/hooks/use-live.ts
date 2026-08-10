"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ListLiveResponse } from "@bookmark-ai/types";
import {
  authHeaders,
  getLive,
  getLiveBaseUrl,
  LIVE_NOT_CONFIGURED,
  ProvisioningError,
  resetLiveBaseCache,
} from "@/lib/api";

/**
 * Reconnect backoff, in ms, walked one step per consecutive failure and reset the
 * moment a stream opens. fetch-event-source's own retry is a flat 1s, which turns
 * a live server that's simply down (or not deployed) into a request every second
 * for as long as the tab is open — a console full of failed GETs and a pointless
 * load on the server. Capped rather than unbounded so a server that comes back
 * after a long outage is still picked up within half a minute.
 */
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

export interface LiveState {
  data: ListLiveResponse | null;
  loading: boolean;
  error: string | null;
  provisioning: boolean;
  /** True while a (re)connect is in flight — lets the UI hint activity. */
  refreshing: boolean;
  /**
   * Tear the current subscription down and prime + resubscribe from scratch.
   * fetch-event-source retries a DROPPED connection on its own, but a failure
   * during the initial GET (server down, DNS, a misconfigured `liveServerUrl`)
   * settles into a terminal error state with nothing retrying it — that's what
   * the view's Retry button drives.
   */
  reload: () => void;
}

/**
 * Subscribe to GET /live/stream (SSE, on the dedicated live server) while the
 * Ongoing segment is mounted. Push-driven, not polled: the server emits a
 * full `state` snapshot (`{devices, enabled, ttlHours}`) on connect and on
 * every change, plus periodic `:keepalive` comments the SSE parser silently
 * discards. Gated on visibility — the connection is only held while
 * `document.visibilityState === "visible"`; it's aborted when the tab is
 * hidden and reestablished (with a fresh GET /live for instant paint before
 * the stream opens) on return.
 *
 * `fast` is kept only for call-site compatibility with the old polling hook
 * — ongoing-view.tsx passes it based on whether a window is expanded — but is
 * now a no-op: SSE has no cadence to adapt, the server pushes on every
 * change regardless. On error the last-known data is kept (the caller dims
 * it) rather than blanked; fetch-event-source auto-reconnects on a dropped
 * connection, so most errors self-heal without user action.
 */
export function useLiveDevices({ fast }: { fast: boolean }): LiveState {
  void fast; // no-op under SSE — kept for signature compatibility only
  // The live base can come from a saved setting (liveServerUrl override) OR the
  // env default, so it isn't known synchronously — start in `loading` and resolve
  // it in the effect via getLiveBaseUrl(). With NEITHER configured that resolves
  // empty and primeAndSubscribe settles on LIVE_NOT_CONFIGURED after making ZERO
  // live network calls, so the Ongoing view shows its error affordance instead of
  // reconnecting against a doomed same-origin 404 forever.
  const [state, setState] = useState<Omit<LiveState, "reload">>(() => ({
    data: null,
    loading: true,
    error: null,
    provisioning: false,
    refreshing: false,
  }));
  const hasData = useRef(false);
  /** Bumped by `reload()` — a dep of the subscribe effect, so incrementing it
   * aborts the live connection and starts a fresh prime + subscribe. */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    // Drop the module-cached base too: one reason a retry is being pressed is a
    // just-corrected `liveServerUrl`, and the cached promise would keep the
    // reconnect pointed at the old (broken) server for the rest of the page.
    resetLiveBaseCache();
    setState((s) => ({ ...s, loading: true, error: null }));
    setReloadKey((k) => k + 1);
  }, []);

  const applySnapshot = useCallback((data: ListLiveResponse) => {
    hasData.current = true;
    setState({ data, loading: false, error: null, provisioning: false, refreshing: false });
  }, []);

  const primeAndSubscribe = useCallback(
    async (signal: AbortSignal) => {
      // A saved liveServerUrl override wins over the env default; resolve the
      // base (cached after the first call) before any live network call. Empty
      // = neither configured → live off, exactly like the old empty-env case.
      const base = await getLiveBaseUrl();
      if (signal.aborted) return;
      if (!base) {
        setState({
          data: null,
          loading: false,
          error: LIVE_NOT_CONFIGURED,
          provisioning: false,
          refreshing: false,
        });
        return;
      }

      // Initial snapshot for instant first paint (or on return-to-tab) — the
      // stream's own connect-time `state` frame would otherwise leave the
      // grid blank until the SSE connection finishes establishing.
      try {
        const data = await getLive(signal);
        if (signal.aborted) return;
        applySnapshot(data);
      } catch (err) {
        if (signal.aborted) return;
        const e = err as Error;
        if (e.name === "AbortError") return;
        // The fetch settled (in failure) — loading must clear, or the view's
        // `loading && !data` skeleton wins over its own error affordance and
        // an unreachable live server looks like an eternal spinner.
        if (e instanceof ProvisioningError) {
          setState((s) => ({ ...s, loading: false, provisioning: true, error: null }));
        } else {
          setState((s) => ({ ...s, loading: false, error: e.message }));
        }
      }
      if (signal.aborted) return;

      setState((s) => ({ ...s, refreshing: true }));
      // Consecutive-failure counter for the backoff below. Local to this
      // subscription: a reload() or a return-to-tab starts a fresh one at 1s.
      let attempt = 0;
      try {
        await fetchEventSource(`${base}/live/stream`, {
          headers: await authHeaders(),
          signal,
          openWhenHidden: false,
          async onopen(res) {
            if (signal.aborted) return;
            if (!res.ok) throw new Error(`Live stream failed (${res.status})`);
            // Connected — the next failure starts the backoff over from 1s.
            attempt = 0;
            setState((s) => ({ ...s, refreshing: false, error: null }));
          },
          onmessage(ev) {
            if (ev.event !== "state" || !ev.data) return;
            try {
              applySnapshot(JSON.parse(ev.data) as ListLiveResponse);
            } catch {
              // Malformed frame — ignore and wait for the next one rather
              // than tearing down a connection that's otherwise healthy.
            }
          },
          onerror(err) {
            if (signal.aborted) {
              // Tearing down (unmount/hidden) — throwing stops fetch-event-
              // source's internal retry loop instead of scheduling one.
              throw err;
            }
            // Keep last-known data (caller dims it).
            setState((s) => ({
              ...s,
              error: (err as Error)?.message ?? "Live connection lost",
            }));
            // A returned number overrides fetch-event-source's flat 1s retry
            // interval with our capped exponential one.
            const delay =
              RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
            attempt++;
            return delay;
          },
        });
      } catch (err) {
        if (signal.aborted) return;
        setState((s) => ({ ...s, error: (err as Error)?.message ?? "Live connection lost" }));
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    // The base is resolved async inside primeAndSubscribe (it may come from a
    // saved setting), which no-ops on an empty base — so no synchronous guard here.
    let controller: AbortController | null = null;

    const start = () => {
      if (document.visibilityState !== "visible") return;
      controller = new AbortController();
      void primeAndSubscribe(controller.signal);
    };
    const stop = () => {
      controller?.abort();
      controller = null;
    };

    start();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        stop();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [primeAndSubscribe, reloadKey]);

  return { ...state, reload };
}
