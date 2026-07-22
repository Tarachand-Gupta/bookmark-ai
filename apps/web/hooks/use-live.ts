"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { ListLiveResponse } from "@bookmark-ai/types";
import {
  authHeaders,
  getLive,
  LIVE_API_URL,
  LIVE_NOT_CONFIGURED,
  ProvisioningError,
} from "@/lib/api";

export interface LiveState {
  data: ListLiveResponse | null;
  loading: boolean;
  error: string | null;
  provisioning: boolean;
  /** True while a (re)connect is in flight — lets the UI hint activity. */
  refreshing: boolean;
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
  // With no live server configured (empty NEXT_PUBLIC_LIVE_API_URL) every live
  // fetch would hit this app's own origin and 404, and fetch-event-source would
  // reconnect against that 404 forever. Start settled on a clear error and make
  // ZERO network calls (the useEffect below bails too), so the Ongoing view
  // shows its error affordance instead of spinning.
  const [state, setState] = useState<LiveState>(() => ({
    data: null,
    loading: Boolean(LIVE_API_URL),
    error: LIVE_API_URL ? null : LIVE_NOT_CONFIGURED,
    provisioning: false,
    refreshing: false,
  }));
  const hasData = useRef(false);

  const applySnapshot = useCallback((data: ListLiveResponse) => {
    hasData.current = true;
    setState({ data, loading: false, error: null, provisioning: false, refreshing: false });
  }, []);

  const primeAndSubscribe = useCallback(
    async (signal: AbortSignal) => {
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
        if (e instanceof ProvisioningError) {
          setState((s) => ({ ...s, loading: !hasData.current, provisioning: true, error: null }));
        } else {
          setState((s) => ({ ...s, loading: !hasData.current, error: e.message }));
        }
      }
      if (signal.aborted) return;

      setState((s) => ({ ...s, refreshing: true }));
      try {
        await fetchEventSource(`${LIVE_API_URL}/live/stream`, {
          headers: await authHeaders(),
          signal,
          openWhenHidden: false,
          async onopen(res) {
            if (signal.aborted) return;
            if (!res.ok) throw new Error(`Live stream failed (${res.status})`);
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
            // Keep last-known data (caller dims it); returning undefined
            // lets fetch-event-source apply its own reconnect backoff.
            setState((s) => ({
              ...s,
              error: (err as Error)?.message ?? "Live connection lost",
            }));
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
    if (!LIVE_API_URL) return; // no live server — never touch the network
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
  }, [primeAndSubscribe]);

  return state;
}
