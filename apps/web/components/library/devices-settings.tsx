"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveDevice } from "@bookmark-ai/types";
import { AlertTriangle, ChevronDown, Chrome, Compass, Flame, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSettingsResource } from "./account-details-provider";
import { FEATURE_ICONS } from "./feature-icons";
import {
  forgetAllLiveDevices,
  forgetLiveDevice,
  resetLiveBaseCache,
  setLiveEnabled,
  updateLiveDeviceSettings,
  updateSettings,
} from "@/lib/api";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-section";

/** Canonical live-sessions glyph, shared with sidebar/tour via FEATURE_ICONS. */
const LiveIcon = FEATURE_ICONS.live;

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
  const resource = useSettingsResource("devices");
  const loading = resource.loading;
  const loadError = resource.error;
  const [enabled, setEnabled] = useState(resource.data?.enabled ?? false);
  const [devices, setDevices] = useState<LiveDevice[]>(resource.data?.devices ?? []);

  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forgettingAll, setForgettingAll] = useState(false);

  useEffect(() => {
    if (!resource.data || toggling || busyId || forgettingAll) return;
    setEnabled(resource.data.enabled);
    setDevices(resource.data.devices);
  }, [resource.data, toggling, busyId, forgettingAll]);

  const refresh = async () => {
    if (!resource.isCurrent()) return;
    const res = await resource.invalidate();
    if (res && resource.isCurrent()) { setEnabled(res.enabled); setDevices(res.devices); }
  };

  const toggle = async (next: boolean) => {
    setToggling(true);
    setActionError(null);
    // Optimistic: off purges server-side in the same request, so clear locally too.
    setEnabled(next);
    if (!next) setDevices([]);
    try {
      await setLiveEnabled(next);
      resource.update(previous => previous && ({ ...previous, enabled: next, devices: next ? previous.devices : [] }));
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
      resource.update(previous => previous && ({ ...previous, devices: previous.devices.filter(d => d.deviceId !== id) }));
      await refresh();
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
      resource.update(previous => previous && ({ ...previous, devices: [] }));
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
      await refresh();
    } finally {
      setForgettingAll(false);
    }
  };

  // Per-device "new windows share by default" policy. Optimistic: flip the local
  // device immediately, revert (to the opposite of what we set) if the PATCH fails.
  const setNewWindows = async (id: string, shared: boolean) => {
    setActionError(null);
    setDevices((ds) => ds.map((d) => (d.deviceId === id ? { ...d, newWindowsShared: shared } : d)));
    try {
      await updateLiveDeviceSettings(id, { newWindowsShared: shared });
      resource.update(previous => previous && ({ ...previous, devices: previous.devices.map(d => d.deviceId === id ? { ...d, newWindowsShared: shared } : d) }));
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
      setDevices((ds) =>
        ds.map((d) => (d.deviceId === id ? { ...d, newWindowsShared: !shared } : d)),
      );
    }
  };

  return (
    <SettingsSection
      title="Live sessions"
      icon={LiveIcon}
      description="See the tabs your other devices have open in real time, and manage those devices."
    >
      {loadError && <p role="alert" className="text-sm text-destructive">Couldn’t load devices: {loadError} <Button variant="ghost" size="sm" onClick={() => void resource.refresh()}>Retry</Button></p>}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : !resource.data ? null : (
        <>
          <SettingsRow
            label="Show my open tabs"
            htmlFor="live-enabled"
            control={
              <Switch id="live-enabled" checked={enabled} disabled={toggling} onChange={toggle} />
            }
            description="Your browsers send the list of tabs they have open — title, address, and icon — so you can pick one up from your phone. Nothing is saved until you press Save. Private windows are never sent. Off by default."
          />

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          {enabled && (
            <SettingsGroup
              divided
              title="Devices"
              action={
                devices.length > 1 && (
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
                )
              }
            >
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
                      onSetNewWindows={(shared) => setNewWindows(device.deviceId, shared)}
                    />
                  ))}
                </div>
              )}

              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                Forgetting a device deletes its tabs from the server. It starts again next time
                that browser checks in, unless you turn the extension’s own switch off there. Device
                names are set in the extension’s popup.
              </p>
            </SettingsGroup>
          )}

        </>
      )}
      <LiveServerUrlField />
    </SettingsSection>
  );
}

/**
 * The optional custom live-server URL, tucked behind a "Use my own live server"
 * disclosure (collapsed unless a custom URL is already saved). Live tabs stream
 * through this server; empty means the built-in default (`NEXT_PUBLIC_LIVE_API_URL`).
 * Because pointing live sessions at a self-hosted server can break the feature,
 * the URL input + Save are gated behind an "I know what I'm doing" checkbox.
 * Saving resets lib/api's cached live base so the next live connect uses the new URL.
 */
function LiveServerUrlField() {
  const resource = useSettingsResource("settings");
  const devicesResource = useSettingsResource("devices", false);
  const dirty = useRef(false);
  const initialized = useRef(false);
  const [value, setValue] = useState("");
  // Disclosure + gate: both start open/checked when a custom URL already exists,
  // so the user can see and edit what they set instead of being locked out.
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const settings = resource.data;
    if (!settings || initialized.current || dirty.current) return;
    initialized.current = true;
    const hasCustom = settings.liveServerUrl != null;
    setValue(settings.liveServerUrl ?? "");
    setOpen(hasCustom);
    setAcknowledged(hasCustom);
  }, [resource.data]);

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const { settings } = await updateSettings({
        liveServerUrl: value.trim() || null,
      });
      if (!resource.isCurrent()) return;
      resource.remember(settings);
      setValue(settings.liveServerUrl ?? "");
      // The live base is cached per page load in lib/api — drop it so the next
      // connect picks up this URL.
      resetLiveBaseCache();
      void devicesResource.invalidate();
      setSavedMsg("Saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const locked = !acknowledged;

  return (
    // A SettingsGroup for the hairline + spacing; the disclosure trigger plays
    // the part of the group title (same text-sm semibold-ish weight), so this
    // block lines up with "Devices" above it.
    <SettingsGroup divided>
      {resource.error && <p role="alert" className="text-sm text-destructive">Couldn’t load live server settings: {resource.error} <Button variant="ghost" size="sm" onClick={() => void resource.refresh()}>Retry</Button></p>}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          Use my own live server
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
            <div className="space-y-1.5">
              <label htmlFor="live-server-ack" className="flex cursor-pointer items-start gap-2 text-sm font-medium">
                <input
                  id="live-server-ack"
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => {
                    setAcknowledged(e.target.checked);
                    setSavedMsg(null);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-amber-600 dark:accent-amber-500"
                />
                I know what I&apos;m doing, allow me.
              </label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This changes the live server your tabs stream through. If the self-hosted server is
                misconfigured or unavailable, live sessions may stop working — we&apos;re not
                responsible for the feature misbehaving on a custom server. Leave empty to use the
                built-in one.
              </p>
            </div>
          </div>

          <SettingsRow label="Live server URL" htmlFor="live-server-url" muted={locked}>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="live-server-url"
                type="url"
                inputMode="url"
                value={value}
                disabled={locked}
                onChange={(e) => {
                  dirty.current = true;
                  setValue(e.target.value);
                  setSavedMsg(null);
                }}
                placeholder="Default server"
                className="w-full min-w-0 flex-1"
              />
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={locked || saving || !resource.data || !resource.active}
                className="shrink-0"
              >
                {saving ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
            {savedMsg && <p className="text-sm text-emerald-600 dark:text-emerald-500">{savedMsg}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </SettingsRow>
        </CollapsibleContent>
      </Collapsible>
    </SettingsGroup>
  );
}

function DeviceRow({
  device,
  busy,
  onForget,
  onSetNewWindows,
}: {
  device: LiveDevice;
  busy: boolean;
  onForget: () => void;
  onSetNewWindows: (shared: boolean) => void | Promise<void>;
}) {
  const { filled } = deviceFreshness(device.lastSeenAgeSeconds);
  const BrowserIcon = BROWSER_ICONS[device.browser] ?? Globe;
  // Absent policy ⇒ new windows share by default (matches the server default).
  const newWindowsShared = device.newWindowsShared ?? true;
  const [savingPolicy, setSavingPolicy] = useState(false);
  const togglePolicy = async () => {
    setSavingPolicy(true);
    try {
      await onSetNewWindows(!newWindowsShared);
    } finally {
      setSavingPolicy(false);
    }
  };
  const policyId = `newwin-${device.deviceId}`;

  return (
    <div className="space-y-2.5 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
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
      <div className="flex items-center justify-between gap-4 pl-[26px]">
        <label htmlFor={policyId} className="text-xs text-muted-foreground">
          Enable live session on any new window
        </label>
        <Switch
          id={policyId}
          checked={newWindowsShared}
          disabled={savingPolicy}
          onChange={() => void togglePolicy()}
        />
      </div>
    </div>
  );
}

/** Minimal accessible switch — no shadcn Switch primitive is installed, and the
 * CLI that would add one rewrites globals.css theme tokens. Shared with
 * sync-settings.tsx. */
export function Switch({
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
