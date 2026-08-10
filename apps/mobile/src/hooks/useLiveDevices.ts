import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import EventSource from "react-native-sse";
import type { LiveDevice, ListLiveResponse } from "@bookmark-ai/types";
import { authHeaders, getLiveBaseUrl, listLiveDevices, ProvisioningError } from "../api";
import { usePreferences } from "../context/PreferencesContext";

export type SessionsSegment = "saved" | "ongoing";

type LiveStreamEvent = "state";

/**
 * The ONE thing the user is told when the live reader can't be reached. Never
 * surface the underlying exception: RN hands back transport strings like
 * "Failed to connect to /10.0.2.2:8091" (Android) or a bare "Network request
 * failed", which read as a crash in the middle of the Ongoing segment. The raw
 * detail goes to console.warn for whoever is debugging.
 */
const LIVE_UNREACHABLE = "Couldn't reach the live sessions server.";

function reportLiveFailure(err: unknown): string {
  console.warn("[live] unreachable:", err instanceof Error ? err.message : String(err));
  return LIVE_UNREACHABLE;
}

export interface LiveDevicesState {
  devices: LiveDevice[];
  enabled: boolean;
  ttlHours: number;
  /** First load with nothing to show yet — render a spinner, not empty state A. */
  loading: boolean;
  refreshing: boolean;
  /** Always human copy — never a raw exception string (see LIVE_UNREACHABLE). */
  error: string | null;
  /** 503 code === "provisioning" — the tenant DB is still being created. */
  provisioning: boolean;
  /** No longer meaningful now that reads are a push stream, not a poll loop
   * (nothing to auto-pause) — kept `false` for return-shape stability so
   * SessionsScreen needs zero changes. */
  paused: boolean;
  /** At least one successful fetch/frame — distinguishes "off/none" from "not asked yet". */
  loaded: boolean;
  refresh: () => void;
  /** No-op now — was used to reset the old idle-pause timer, which the SSE
   * stream has no equivalent of. Kept for signature stability. */
  ping: () => void;
}

/**
 * The Ongoing segment's data story. A single SSE connection to the dedicated
 * live server replaces the old adaptive-polling loop: one `GET /live` for an
 * instant first paint (and as the provisioning/error fallback), then
 * `GET /live/stream` pushes full-snapshot `state` frames on every change plus
 * keepalives. The connection is held only while `active && segment ===
 * "ongoing" && AppState === "active"` (all three mandatory) — same gating the
 * poll loop used — so it can never run in the user's pocket.
 */
export function useLiveDevices({
  active,
  segment,
  // Cadence knob from the old adaptive poller; the stream pushes on every
  // server-side change regardless, so there's no "fast while expanded" dial
  // anymore. Kept in the signature so callers (SessionsScreen) don't change.
  expanded: _expanded,
}: {
  active: boolean;
  segment: SessionsSegment;
  expanded: boolean;
}): LiveDevicesState {
  const { serverTarget } = usePreferences(); // switching servers reconnects
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [enabled, setEnabled] = useState(false); // never assume enabled (§4.9 hydration)
  const [ttlHours, setTtlHours] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  const onOngoing = active && segment === "ongoing";

  const applySnapshot = useCallback((data: ListLiveResponse) => {
    setDevices(data.devices);
    setEnabled(data.enabled);
    setTtlHours(data.ttlHours);
    setError(null);
    setProvisioning(false);
    setLoaded(true);
  }, []);

  // Hold the connection only while on the Ongoing segment, foregrounded, and
  // active; reconnect whenever the server target changes or a refresh is
  // requested. Mirrors the old effect's dependency shape.
  useEffect(() => {
    if (!onOngoing || !appActive) return;
    let cancelled = false;
    let es: EventSource<LiveStreamEvent> | null = null;

    const connect = async () => {
      setLoading(true);
      // Initial GET for instant first paint (and the ProvisioningError path,
      // which the stream's own error event can't distinguish from any other
      // failure) before the stream takes over.
      try {
        const data = await listLiveDevices();
        if (cancelled) return;
        applySnapshot(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ProvisioningError) {
          setProvisioning(true); // keep last-known devices; this is not a failure
        } else {
          // Keep last-known data (rendered dimmed) rather than dropping to an
          // error screen — a stale tab list is still useful (§4.7).
          setError(reportLiveFailure(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
      if (cancelled) return;

      const [headers, liveBase] = await Promise.all([authHeaders(), getLiveBaseUrl()]);
      if (cancelled) return; // effect torn down while headers/base were resolving

      const stream = new EventSource<LiveStreamEvent>(`${liveBase}/live/stream`, {
        headers,
      });
      es = stream;

      stream.addEventListener("state", (event) => {
        if (cancelled || !event.data) return;
        try {
          applySnapshot(JSON.parse(event.data) as ListLiveResponse);
        } catch {
          // Malformed frame — ignore and keep the last-known state.
        }
      });

      stream.addEventListener("error", (event) => {
        if (cancelled) return;
        // Keep last-known devices (same "stale is still useful" rule as the
        // initial fetch) — never clear `devices`/`loaded` here.
        if (event.type === "error" || event.type === "exception") {
          setError(reportLiveFailure(event.message));
        }
      });
      // "open" and keepalive comments need no handling.
    };

    void connect();

    return () => {
      cancelled = true;
      es?.removeAllEventListeners();
      es?.close();
    };
  }, [onOngoing, appActive, serverTarget, reloadKey, applySnapshot]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  // No idle timer left to reset — kept as a no-op so callers need no changes.
  const ping = useCallback(() => {}, []);

  return {
    devices,
    enabled,
    ttlHours,
    loading,
    refreshing,
    error,
    provisioning,
    paused: false,
    loaded,
    refresh,
    ping,
  };
}
