"use client";

import Link from "next/link";
import type { LiveDevice } from "@bookmark-ai/types";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { BROWSER_ICONS, DEVICE_ICONS } from "@/components/library/device-badges";
import { DashboardCard } from "./dashboard-card";
import { liveHref } from "./links";

/**
 * "Live now" (doc §3.3): one row per device currently mirroring its open tabs,
 * fed by the SAME SSE stream the live view uses, so it updates without a refresh.
 *
 * Two hard rules, both from principle 3:
 *  - no devices ⇒ render nothing (not an empty box);
 *  - live server down / not configured / errored ⇒ render nothing. The dashboard
 *    NEVER shows an error card: a broken optional subsystem must not be the first
 *    thing a user sees on their landing page. The live view itself owns the
 *    diagnostics and the retry affordance.
 */
export function LiveNowCard({
  devices,
  className,
}: {
  devices: LiveDevice[] | null;
  className?: string;
}) {
  const rows = devices ?? [];
  if (rows.length === 0) return null;

  return (
    <DashboardCard
      title="Live now"
      Icon={FEATURE_ICONS.live}
      count={rows.length}
      footerHref={liveHref()}
      footerLabel="Live sessions"
      className={className}
      flush
    >
      <ul className="divide-y">
        {rows.map((device) => (
          <li key={device.deviceId}>
            <Link
              href={liveHref()}
              className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-muted/50"
            >
              <LiveRow device={device} />
            </Link>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

function LiveRow({ device }: { device: LiveDevice }) {
  const { filled } = deviceFreshness(device.lastSeenAgeSeconds);
  const DeviceIcon = DEVICE_ICONS[device.device] ?? Globe;
  const BrowserIcon = BROWSER_ICONS[device.browser] ?? Globe;
  const windows = device.windows.length;

  return (
    <>
      {/* Filled + pulsing only while genuinely fresh; a hollow ring for a device
          that has gone quiet — same honesty rule as the live view's presence dot. */}
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          filled
            ? "bg-emerald-500 motion-safe:animate-pulse"
            : "border border-muted-foreground/60 bg-transparent",
        )}
      />
      <DeviceIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{device.label || "Device"}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BrowserIcon className="size-3 shrink-0" aria-hidden />
          <span className="tabular-nums">
            {device.tabCount} tab{device.tabCount === 1 ? "" : "s"}
          </span>
          {windows > 1 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{windows} windows</span>
            </>
          )}
        </p>
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {formatDeviceAge(device.lastSeenAgeSeconds)}
      </span>
    </>
  );
}
