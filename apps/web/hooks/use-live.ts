"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListLiveResponse } from "@bookmark-ai/types";
import { getLive, ProvisioningError } from "@/lib/api";

/** A window is expanded and being read — poll tight so open tabs stay live-ish. */
const FAST_MS = 4_000;
/** Ongoing is showing but nothing is expanded — keep presence/freshness current. */
const SLOW_MS = 15_000;

export interface LiveState {
  data: ListLiveResponse | null;
  loading: boolean;
  error: string | null;
  provisioning: boolean;
  /** True while a poll (not the first load) is in flight — lets the UI hint activity. */
  refreshing: boolean;
}

/**
 * Poll GET /api/live while the Ongoing segment is mounted. Adaptive + gated:
 * FAST_MS when a window is expanded, SLOW_MS otherwise, and fully paused while
 * the tab is hidden (resumes with an immediate fetch on return). Mounting only
 * under the Ongoing segment is what satisfies "pause when Saved". On error the
 * last-known data is kept (the caller dims it) rather than blanked.
 */
export function useLiveDevices({ fast }: { fast: boolean }): LiveState {
  const [state, setState] = useState<LiveState>({
    data: null,
    loading: true,
    error: null,
    provisioning: false,
    refreshing: false,
  });
  const hasData = useRef(false);

  const load = useCallback(async (signal: AbortSignal, quiet: boolean) => {
    setState((s) =>
      quiet ? { ...s, refreshing: true } : { ...s, loading: !hasData.current, error: null },
    );
    try {
      const data = await getLive(signal);
      if (signal.aborted) return;
      hasData.current = true;
      setState({ data, loading: false, error: null, provisioning: false, refreshing: false });
    } catch (err) {
      if (signal.aborted) return;
      const e = err as Error;
      if (e.name === "AbortError") return;
      if (e instanceof ProvisioningError) {
        setState((s) => ({
          ...s,
          loading: !hasData.current,
          provisioning: true,
          error: null,
          refreshing: false,
        }));
        return;
      }
      // Keep last-known data; the Ongoing view dims it and shows the error inline.
      setState((s) => ({ ...s, loading: false, error: e.message, refreshing: false }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const arm = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      timer = setInterval(() => void load(controller.signal, true), fast ? FAST_MS : SLOW_MS);
    };

    // Immediate fetch on mount and whenever the cadence changes (e.g. a window
    // was just expanded): quiet once we already have data so it never flashes a
    // skeleton mid-view.
    void load(controller.signal, hasData.current);
    arm();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(controller.signal, true);
        arm();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      controller.abort();
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, fast]);

  return state;
}
