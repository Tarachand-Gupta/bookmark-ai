import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { LiveDevice } from "@bookmark-ai/types";
import { listLiveDevices, ProvisioningError } from "../api";
import { usePreferences } from "../context/PreferencesContext";

export type SessionsSegment = "saved" | "ongoing";

// Adaptive cadence (§4.1 / §9.1.1 rework — supersedes §4.7's flat 30s floor):
// fast while a window is expanded, slow while the segment is merely open, and
// no timer at all otherwise. End-to-end latency is ~5s (extension debounce) plus
// one interval, so a few seconds while reading is the useful ceiling.
const FAST_MS = 4000;
const SLOW_MS = 30000;
// Battery guard: stop polling after this long without an interaction. The app
// keeps every screen mounted (App.tsx), so an ungated timer would run forever.
const IDLE_PAUSE_MS = 5 * 60 * 1000;

export interface LiveDevicesState {
  devices: LiveDevice[];
  enabled: boolean;
  ttlHours: number;
  /** First load with nothing to show yet — render a spinner, not empty state A. */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** 503 code === "provisioning" — the tenant DB is still being created. */
  provisioning: boolean;
  /** Auto-paused after idle; the UI prompts a pull-to-refresh to resume. */
  paused: boolean;
  /** At least one successful fetch — distinguishes "off/none" from "not asked yet". */
  loaded: boolean;
  refresh: () => void;
  /** Register a user interaction (expand, scroll) to reset the idle timer. */
  ping: () => void;
}

/**
 * The Ongoing segment's data story. Mirrors useSessions' load/refresh shape
 * (serverTarget dep, reloadKey counter, loadId stale-write guard) and adds the
 * app's first polling loop. Every poll is gated on `active && app foregrounded
 * && segment === "ongoing"` (all three mandatory) so it can never run in the
 * user's pocket; the interval tightens only while a window is expanded.
 */
export function useLiveDevices({
  active,
  segment,
  expanded,
}: {
  active: boolean;
  segment: SessionsSegment;
  expanded: boolean;
}): LiveDevicesState {
  const { serverTarget } = usePreferences(); // switching servers refetches
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [enabled, setEnabled] = useState(false); // never assume enabled (§4.9 hydration)
  const [ttlHours, setTtlHours] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [pingCount, setPingCount] = useState(0);
  // Guards stale async writes: only the latest load may touch state.
  const loadId = useRef(0);

  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  const onOngoing = active && segment === "ongoing";

  const load = useCallback(async (kind: "initial" | "poll") => {
    const id = ++loadId.current;
    if (kind === "initial") setLoading(true);
    try {
      const data = await listLiveDevices();
      if (loadId.current !== id) return;
      setDevices(data.devices);
      setEnabled(data.enabled);
      setTtlHours(data.ttlHours);
      setError(null);
      setProvisioning(false);
      setLoaded(true);
    } catch (err) {
      if (loadId.current !== id) return;
      if (err instanceof ProvisioningError) {
        setProvisioning(true); // keep last-known devices; this is not a failure
      } else {
        // Keep last-known data (rendered dimmed) rather than dropping to an error
        // screen — a stale tab list is still useful (§4.7).
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (loadId.current === id) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Initial fetch when the Ongoing segment opens, the server switches, or a
  // refresh is requested. Never fires on the Saved segment (§5.6 landing rule).
  useEffect(() => {
    if (!onOngoing) return;
    void load("initial");
  }, [onOngoing, serverTarget, reloadKey, load]);

  // Adaptive polling. The effect tears the interval down on every dependency
  // change, so a hidden/backgrounded/paused screen holds no live timer.
  useEffect(() => {
    if (!onOngoing || !appActive || paused) return;
    const period = expanded ? FAST_MS : SLOW_MS;
    const timer = setInterval(() => void load("poll"), period);
    return () => clearInterval(timer);
  }, [onOngoing, appActive, paused, expanded, serverTarget, reloadKey, load]);

  // Idle auto-pause. Re-armed by any expand toggle, scroll ping, or foreground;
  // firing stops the poll loop until a pull-to-refresh clears `paused`.
  useEffect(() => {
    if (!onOngoing || !appActive || paused) return;
    const timer = setTimeout(() => setPaused(true), IDLE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [onOngoing, appActive, paused, expanded, pingCount]);

  // Leaving the Ongoing view clears the pause so a later visit resumes cleanly.
  useEffect(() => {
    if (!onOngoing) setPaused(false);
  }, [onOngoing]);

  const refresh = useCallback(() => {
    setPaused(false);
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  const ping = useCallback(() => setPingCount((c) => c + 1), []);

  return {
    devices,
    enabled,
    ttlHours,
    loading,
    refreshing,
    error,
    provisioning,
    paused,
    loaded,
    refresh,
    ping,
  };
}
