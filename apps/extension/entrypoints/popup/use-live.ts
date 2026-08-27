import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { getDeviceLabel, setDeviceLabel } from "@/lib/device-id";
import { diag } from "@/lib/diag";
import { liveEnabledItem } from "@/lib/live-storage";
import {
  requestLivePushNow,
  requestLiveWindowGet,
  requestLiveWindowSet,
  requestSetLiveEnabled,
} from "@/lib/messages";
import { isCapturableWindow } from "@/lib/session-filter";

/**
 * All live-tabs popup state in one hook, because the feature now has TWO
 * surfaces that must agree: the collapsed bento tile (status line + switch) and
 * the expanded panel (per-window switches, device rename). Keeping the state
 * above both is what lets the tile's switch and the panel's switch be the same
 * control rather than two copies that drift.
 *
 * Nothing here changes the popup↔background contract: window fan-out reuses the
 * existing per-window `LIVE_WINDOW_GET`/`LIVE_WINDOW_SET` messages, once per
 * open window (capped at 12 by the live payload schema, so the fan-out is tiny).
 */

export interface LiveWindowRow {
  id: number;
  /** "This window" for the popup's own window, else "Window N" in scan order —
   * browsers give windows no user-visible name of their own. */
  name: string;
  tabCount: number;
  shared: boolean;
  busy: boolean;
}

export interface LiveState {
  enabled: boolean;
  busy: boolean;
  expanded: boolean;
  windows: LiveWindowRow[];
  /** False until the window scan lands. The status lines suppress their counts
   * until then, so the popup never flashes "On · 0 windows" on open. */
  scanned: boolean;
  /** Windows currently being published (`shared`), for the "On · N windows" and
   * "Sharing N of M windows" lines. */
  sharedCount: number;
  label: string;
  labelSaved: boolean;
  policyDefault: boolean;
  showPolicyHint: boolean;
  error: string | null;
  setExpanded: (next: boolean | ((prev: boolean) => boolean)) => void;
  toggle: () => void;
  toggleWindow: (id: number) => void;
  setLabel: (next: string) => void;
  /** Persist the device name and force an immediate push. Pass the new value
   * explicitly when it isn't in `label` yet (the inline rename input holds its
   * own draft), so the write can't race a pending state update. */
  saveLabel: (next?: string) => void;
}

export function useLive(): LiveState {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [windows, setWindows] = useState<LiveWindowRow[]>([]);
  const [scanned, setScanned] = useState(false);
  const [label, setLabel] = useState("");
  const [labelSaved, setLabelSaved] = useState(false);
  const [policyDefault, setPolicyDefault] = useState(true);
  const [showPolicyHint, setShowPolicyHint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void liveEnabledItem.getValue().then(setEnabled);
    void getDeviceLabel().then(setLabel);

    // One scan of every open window → one row each. `isCapturableWindow` is the
    // same filter the push loop uses, so the popup can never offer a switch for
    // a window (incognito, devtools, a popup window) that would never be sent.
    void (async () => {
      try {
        const [all, current] = await Promise.all([
          browser.windows.getAll({ populate: true }),
          browser.windows.getCurrent(),
        ]);
        const capturable = all.filter((w) => isCapturableWindow(w) && typeof w.id === "number");
        const rows = await Promise.all(
          capturable.map(async (w, index) => {
            const id = w.id as number;
            const state = await requestLiveWindowGet(id);
            if (index === 0) setPolicyDefault(state.policyDefault);
            return {
              id,
              name: id === current.id ? "This window" : `Window ${index + 1}`,
              tabCount: (w.tabs ?? []).filter((t) => t.url && /^https?:/i.test(t.url)).length,
              shared: state.shared,
              busy: false,
            } satisfies LiveWindowRow;
          }),
        );
        setWindows(rows);
        setScanned(true);
        diag("popup", "live windows scanned", { count: rows.length });
      } catch (e) {
        // A failed scan still counts as settled — the panel then shows no rows
        // rather than a spinner that never resolves.
        setScanned(true);
        diag("popup", "live window scan failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, []);

  const toggle = useCallback(() => {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next); // optimistic; corrected by the settled result below
    void requestSetLiveEnabled(next)
      .then((result) => {
        setEnabled(result.enabled);
        // The "future windows…" hint appears only when the user just turned live
        // ON in this popup and it stuck; turning off (or a failed turn-on) hides it.
        setShowPolicyHint(next && result.enabled);
        if (!result.ok) {
          setError(
            next
              ? "Couldn't turn this on — make sure you're signed in, then try again."
              : "Turned off here, but the server couldn't be reached to confirm.",
          );
        }
      })
      .catch(() => {
        setEnabled(!next); // background unreachable — revert the optimistic flip
        setShowPolicyHint(false);
        setError("Couldn't reach the extension background. Try reopening the popup.");
      })
      .finally(() => setBusy(false));
  }, [busy, enabled]);

  const toggleWindow = useCallback((id: number) => {
    setWindows((rows) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.busy) return rows;
      const next = !row.shared;
      // Optimistic flip, settled by the background's echo below.
      void requestLiveWindowSet(id, next).then((result) => {
        setWindows((current) =>
          current.map((r) => (r.id === id ? { ...r, shared: result.shared, busy: false } : r)),
        );
      });
      return rows.map((r) => (r.id === id ? { ...r, shared: next, busy: true } : r));
    });
  }, []);

  const saveLabel = useCallback(
    (next?: string) => {
      const value = next ?? label;
      void (async () => {
        await setDeviceLabel(value);
        setLabel(await getDeviceLabel());
        setLabelSaved(true);
        // The rename carries no tab event, so nothing would carry it to the mirror
        // until the next tab change — force an immediate push (no-op when off).
        void requestLivePushNow();
        setTimeout(() => setLabelSaved(false), 1500);
      })();
    },
    [label],
  );

  return {
    enabled,
    busy,
    expanded,
    windows,
    scanned,
    sharedCount: windows.filter((w) => w.shared).length,
    label,
    labelSaved,
    policyDefault,
    showPolicyHint,
    error,
    setExpanded,
    toggle,
    toggleWindow,
    setLabel,
    saveLabel,
  };
}
