"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveDevice, LiveTab, LiveWindow } from "@bookmark-ai/types";
import {
  ChevronDown,
  Chrome,
  Compass,
  Flame,
  Globe,
  Laptop,
  Loader2,
  Lock,
  Monitor,
  MonitorSmartphone,
  Save,
  Smartphone,
  Tablet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { saveSession } from "@/lib/api";
import { useLiveDevices } from "@/hooks/use-live";
import {
  deviceFreshness,
  formatDeviceAge,
  isOpenableTab,
  OLDER_MIN_SECONDS,
  windowSubtitle,
} from "@/lib/live-format";
import type { SectionId } from "./settings-dialog";
import { ExtensionStoreButton } from "./extension-cta";

const BROWSER_ICONS: Record<string, React.ElementType> = {
  chrome: Chrome,
  firefox: Flame,
  safari: Compass,
  edge: Globe,
  arc: Globe,
  other: Globe,
};

const DEVICE_ICONS: Record<string, React.ElementType> = {
  desktop: Monitor,
  laptop: Laptop,
  mobile: Smartphone,
  tablet: Tablet,
  other: MonitorSmartphone,
};

const windowKey = (deviceId: string, windowId: number) => `${deviceId}:${windowId}`;

export interface OngoingViewProps {
  /** Refetch the saved list after a window is promoted to a saved session. */
  onSaved: () => void;
  /** Deep-link to a Settings section (empty state routes to Devices). */
  onOpenSettings?: (section?: SectionId) => void;
}

/**
 * Open tabs mirrored from every signed-in device: device → window → tab, the
 * same hierarchy as mobile (§4.7). Windows are collapsed by default; expanding
 * one tightens the poll cadence. Any http tab opens in a new tab; redacted and
 * browser-internal tabs render as muted, unopenable text.
 */
export function OngoingView({ onSaved, onOpenSettings }: OngoingViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showOlder, setShowOlder] = useState(false);
  const { data, loading, error, provisioning, refreshing } = useLiveDevices({
    fast: expanded.size > 0,
  });

  // Drop expansion keys for windows that a later poll no longer returns, so the
  // "a window is expanded" poll gate can't stay hot on a window that's gone.
  useEffect(() => {
    if (!data) return;
    setExpanded((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set<string>();
      for (const d of data.devices) for (const w of d.windows) valid.add(windowKey(d.deviceId, w.windowId));
      const next = new Set<string>();
      let changed = false;
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [data]);

  const toggleWindow = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const { fresh, older } = useMemo(() => {
    const devices = data?.devices ?? [];
    return {
      fresh: devices.filter((d) => d.lastSeenAgeSeconds < OLDER_MIN_SECONDS),
      older: devices.filter((d) => d.lastSeenAgeSeconds >= OLDER_MIN_SECONDS),
    };
  }, [data]);

  if (provisioning) return <OngoingNotice icon="spinner">Setting up your account…</OngoingNotice>;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-medium">Could not load open tabs</p>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  // Off — teach, don't scold (§4.7 state A). `enabled` is what tells this apart
  // from "on but no devices".
  if (data && !data.enabled) {
    return (
      <OngoingEmpty
        title="Open tabs are off"
        body="Turn on Show my open tabs and your browsers will show what they have open here — nothing is saved until you press Save."
        action={
          onOpenSettings && (
            <Button size="sm" onClick={() => onOpenSettings("devices")}>
              <MonitorSmartphone aria-hidden />
              Open Settings
            </Button>
          )
        }
      />
    );
  }

  // On, but nothing is reporting (never pushed, or everything aged out) (§4.7 B/C).
  if (data && data.devices.length === 0) {
    return (
      <OngoingEmpty
        title="No devices are open right now"
        body="Install the Bookmark AI extension on a browser you want to see here, then turn on Show my open tabs in the extension. Your open windows will show up on this page."
        action={<ExtensionStoreButton size="sm" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && data && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Showing the last update — couldn’t refresh just now.
        </p>
      )}
      {fresh.map((device) => (
        <DeviceSection
          key={device.deviceId}
          device={device}
          expanded={expanded}
          onToggleWindow={toggleWindow}
          onSaved={onSaved}
          dimmed={Boolean(error)}
        />
      ))}

      {older.length > 0 && (
        <div className="space-y-6">
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setShowOlder((v) => !v)}>
              {showOlder
                ? "Hide older devices"
                : `Show ${older.length} older device${older.length === 1 ? "" : "s"}`}
            </Button>
          </div>
          {showOlder &&
            older.map((device) => (
              <DeviceSection
                key={device.deviceId}
                device={device}
                expanded={expanded}
                onToggleWindow={toggleWindow}
                onSaved={onSaved}
                dimmed={Boolean(error)}
              />
            ))}
        </div>
      )}

      {refreshing && (
        <p className="sr-only" aria-live="polite">
          Refreshing open tabs
        </p>
      )}
    </div>
  );
}

function DeviceSection({
  device,
  expanded,
  onToggleWindow,
  onSaved,
  dimmed,
}: {
  device: LiveDevice;
  expanded: Set<string>;
  onToggleWindow: (key: string) => void;
  onSaved: () => void;
  dimmed: boolean;
}) {
  const { filled, dim } = deviceFreshness(device.lastSeenAgeSeconds);
  const DeviceIcon = DEVICE_ICONS[device.device] ?? MonitorSmartphone;
  const BrowserIcon = BROWSER_ICONS[device.browser] ?? Globe;

  return (
    <section className={cn("space-y-2 transition-opacity", (dim || dimmed) && "opacity-55")}>
      {/* Device = plain section header (text + dot), not a card (§4.7). */}
      <header className="flex items-center gap-2 px-1">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            filled ? "bg-emerald-500" : "border border-muted-foreground/50",
          )}
        />
        <DeviceIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-medium">{device.label || "Unnamed device"}</span>
        <BrowserIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="capitalize text-sm text-muted-foreground">{device.browser}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {formatDeviceAge(device.lastSeenAgeSeconds)}
        </span>
      </header>

      {device.windows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No windows open.</p>
      ) : (
        <div className="space-y-2">
          {device.windows.map((win, i) => (
            <WindowCard
              key={windowKey(device.deviceId, win.windowId)}
              device={device}
              win={win}
              ordinal={i + 1}
              open={expanded.has(windowKey(device.deviceId, win.windowId))}
              onToggle={() => onToggleWindow(windowKey(device.deviceId, win.windowId))}
              stale={dim}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}

      {device.hiddenTabCount > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {device.hiddenTabCount} tab{device.hiddenTabCount === 1 ? "" : "s"} not shown (private or
          local)
        </p>
      )}
    </section>
  );
}

function WindowCard({
  device,
  win,
  ordinal,
  open,
  onToggle,
  stale,
  onSaved,
}: {
  device: LiveDevice;
  win: LiveWindow;
  ordinal: number;
  open: boolean;
  onToggle: () => void;
  stale: boolean;
  onSaved: () => void;
}) {
  const subtitle = windowSubtitle(win.tabs);

  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      className="rounded-xl border bg-card text-card-foreground shadow-sm"
    >
      <div className="flex items-center gap-3 p-3">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-medium">
              Window {ordinal} · {win.tabs.length} tab{win.tabs.length === 1 ? "" : "s"}
            </p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </CollapsibleTrigger>
        <SaveWindowButton device={device} win={win} ordinal={ordinal} stale={stale} onSaved={onSaved} />
      </div>

      <CollapsibleContent>
        <ul className="divide-y border-t">
          {win.tabs.map((tab, i) => (
            <LiveTabRow key={`${tab.url}-${i}`} tab={tab} deviceLabel={device.label} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Saves ONLY this window (owner decision — one window, never all/cross-browser).
 * A stale window asks once before saving (§4.4). */
function SaveWindowButton({
  device,
  win,
  ordinal,
  stale,
  onSaved,
}: {
  device: LiveDevice;
  win: LiveWindow;
  ordinal: number;
  stale: boolean;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "confirm" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const doSave = async () => {
    setStatus("saving");
    setError(null);
    try {
      await saveSession({
        name: `${device.label || "Window"} · Window ${ordinal}`,
        tabs: win.tabs.map((t) => ({
          url: t.url,
          title: t.title,
          favIconUrl: t.favIconUrl ?? undefined,
          windowId: win.windowId,
        })),
        browser: device.browser,
        device: device.device,
      });
      setStatus("saved");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  const onClick = () => {
    if (status === "saving" || status === "saved") return;
    if (stale && status !== "confirm") {
      setStatus("confirm");
      return;
    }
    void doSave();
  };

  const empty = win.tabs.length === 0;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant={status === "confirm" ? "default" : "outline"}
        onClick={onClick}
        disabled={empty || status === "saving" || status === "saved"}
        title={empty ? "This window has no tabs to save" : undefined}
      >
        {status === "saving" ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            Saving…
          </>
        ) : status === "saved" ? (
          "Saved"
        ) : status === "confirm" ? (
          "Save anyway?"
        ) : (
          <>
            <Save className="size-3.5" aria-hidden />
            Save
          </>
        )}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

function LiveTabRow({ tab, deviceLabel }: { tab: LiveTab; deviceLabel: string }) {
  const openable = isOpenableTab(tab);
  const label = tab.title?.trim() || tab.url;

  if (!openable) {
    return (
      <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        {tab.redacted ? (
          <Lock className="size-4 shrink-0" aria-hidden />
        ) : (
          <Globe className="size-4 shrink-0" aria-hidden />
        )}
        <span className="line-clamp-1 flex-1 [overflow-wrap:anywhere]">{label}</span>
        <span className="hidden shrink-0 text-xs sm:inline">
          {tab.redacted ? `link hidden — open on ${deviceLabel || "that device"}` : "not a web page"}
        </span>
      </li>
    );
  }

  return (
    <li>
      <a
        href={tab.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
      >
        <TabIcon favIconUrl={tab.favIconUrl} />
        <span className="line-clamp-1 flex-1 [overflow-wrap:anywhere]">{label}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {domainOf(tab.url)}
        </span>
      </a>
    </li>
  );
}

function TabIcon({ favIconUrl }: { favIconUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!favIconUrl || failed) {
    return <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return (
    <img
      src={favIconUrl}
      alt=""
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm"
    />
  );
}

function OngoingEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

function OngoingNotice({ children, icon }: { children: React.ReactNode; icon?: "spinner" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
      {icon === "spinner" && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </div>
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
