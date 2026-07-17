"use client";

import { useEffect, useState } from "react";
import type { LiveDevice } from "@bookmark-ai/types";
import { Chrome, Compass, Flame, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { forgetAllLiveDevices, forgetLiveDevice, getLive, setLiveEnabled } from "@/lib/api";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";

const BROWSER_ICONS: Record<string, React.ElementType> = {
  chrome: Chrome,
  firefox: Flame,
  safari: Compass,
  edge: Globe,
  arc: Globe,
  other: Globe,
};

/**
 * Settings → Devices. The account-wide "Show my open tabs" opt-in (off by
 * default; turning it off purges every device), and per-device Forget. Device
 * names are read-only here — they're set in the extension popup, the only
 * surface that knows which physical machine it is (§4.5); the browser re-asserts
 * its own label on every check-in.
 */
export function DevicesSection() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [devices, setDevices] = useState<LiveDevice[]>([]);

  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forgettingAll, setForgettingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getLive()
      .then((res) => {
        if (cancelled) return;
        setEnabled(res.enabled);
        setDevices(res.devices);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    try {
      const res = await getLive();
      setEnabled(res.enabled);
      setDevices(res.devices);
    } catch {
      // A failed refresh leaves the last-known list; the next action retries.
    }
  };

  const toggle = async (next: boolean) => {
    setToggling(true);
    setActionError(null);
    // Optimistic: off purges server-side in the same request, so clear locally too.
    setEnabled(next);
    if (!next) setDevices([]);
    try {
      await setLiveEnabled(next);
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
      setEnabled(!next);
      await refresh();
    } finally {
      setToggling(false);
    }
  };

  const forget = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    setDevices((prev) => prev.filter((d) => d.deviceId !== id));
    try {
      await forgetLiveDevice(id);
    } catch (e) {
      setActionError((e as Error).message);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const forgetAll = async () => {
    setForgettingAll(true);
    setActionError(null);
    setDevices([]);
    try {
      await forgetAllLiveDevices();
    } catch (e) {
      setActionError((e as Error).message);
      await refresh();
    } finally {
      setForgettingAll(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Open tabs</h3>
        <p className="text-xs text-muted-foreground">
          See the tabs your other devices have open, and manage those devices.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">Couldn’t load devices: {loadError}</p>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <label htmlFor="live-enabled" className="text-sm font-medium">
                Show my open tabs
              </label>
              <Switch
                id="live-enabled"
                checked={enabled}
                disabled={toggling}
                onChange={toggle}
              />
            </div>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Your browsers send the list of tabs they have open — title, address, and icon — so
              you can pick one up from your phone. Nothing is saved until you press Save. Private
              windows are never sent. Off by default.
            </p>
          </div>

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          {enabled && (
            <div className="space-y-3 border-t pt-5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Devices
                </h4>
                {devices.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={forgetAll}
                    disabled={forgettingAll}
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  >
                    {forgettingAll ? "Forgetting…" : "Forget all"}
                  </Button>
                )}
              </div>

              {devices.length === 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No devices are reporting yet. Install the Bookmark AI extension and turn on{" "}
                  <strong className="font-medium text-foreground">Show my open tabs</strong> in the
                  extension — this browser will then appear here.
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {devices.map((device) => (
                    <DeviceRow
                      key={device.deviceId}
                      device={device}
                      busy={busyId === device.deviceId}
                      onForget={() => forget(device.deviceId)}
                    />
                  ))}
                </div>
              )}

              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                Forgetting a device deletes its tabs from the server. It starts again next time
                that browser checks in, unless you turn the extension’s own switch off there. Device
                names are set in the extension’s popup.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeviceRow({
  device,
  busy,
  onForget,
}: {
  device: LiveDevice;
  busy: boolean;
  onForget: () => void;
}) {
  const { filled } = deviceFreshness(device.lastSeenAgeSeconds);
  const BrowserIcon = BROWSER_ICONS[device.browser] ?? Globe;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          filled ? "bg-emerald-500" : "border border-muted-foreground/50",
        )}
      />
      <BrowserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{device.label || "Unnamed device"}</p>
        <p className="truncate text-xs capitalize text-muted-foreground">
          {device.browser} · <span className="normal-case">{formatDeviceAge(device.lastSeenAgeSeconds)}</span>
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onForget}
        disabled={busy}
        className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive"
      >
        {busy ? "Forgetting…" : "Forget"}
      </Button>
    </div>
  );
}

/** Minimal accessible switch — no shadcn Switch primitive is installed, and the
 * CLI that would add one rewrites globals.css theme tokens. */
function Switch({
  checked,
  disabled,
  onChange,
  id,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-5 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
