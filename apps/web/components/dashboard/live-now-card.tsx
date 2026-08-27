import Link from "next/link";
import type { LiveDevice } from "@bookmark-ai/types";
import { ChevronRight, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { liveAgeLabel } from "@/lib/dashboard";
import { deviceFreshness } from "@/lib/live-format";
import { DEVICE_ICONS } from "@/components/library/device-badges";
import { FEATURE_ICONS } from "@/components/library/feature-icons";
import { DashboardCard, DashboardCardEmpty } from "./dashboard-card";
import { liveHref } from "./links";

/**
 * Live now — the dashboard's FIRST card, and the only place on the page that
 * talks about live devices.
 *
 * Live state used to leak into three unrelated surfaces with three vocabularies
 * (a sidebar pip, a "N live" pill in the resume hero, and live rows mixed into
 * that hero's ranked list of not-live things). It is one noun now: one card, one
 * row per device, one destination.
 *
 * The emerald presence dot is the ONLY status colour on this page — that's what
 * makes it mean something. A device that's gone quiet (>10 min, the live view's
 * own FRESH_MAX_SECONDS) gets a muted ring instead, never a second colour.
 */

/** Rows before "View all" takes over. Four keeps this card the same height as
 * Saved sessions beside it, which is what makes the top row of the grid scan. */
const VISIBLE_DEVICES = 4;

export function LiveNowCard({
  devices,
  className,
}: {
  /** Ranked by `rankLiveDevices`. `null` = live is off or unreachable, which is
   * a different sentence from "on, but nothing is open right now". */
  devices: LiveDevice[] | null;
  className?: string;
}) {
  const rows = devices?.slice(0, VISIBLE_DEVICES) ?? [];
  // `|| null`, not `?? null`: a bare "0" beside the title while the body already
  // says nothing is open is the same fact twice.
  const count = devices?.length || null;

  return (
    <DashboardCard
      title="Live now"
      Icon={FEATURE_ICONS.live}
      count={count}
      viewAllHref={liveHref()}
      className={className}
      flush
    >
      {rows.length === 0 ? (
        <DashboardCardEmpty>
          {devices === null
            ? "Live sessions are off — turn them on to see the tabs open on your other devices."
            : "Nothing is open on your other devices right now."}
        </DashboardCardEmpty>
      ) : (
        <ul className="divide-y">
          {rows.map((device) => (
            <li key={device.deviceId}>
              <LiveDeviceRow device={device} />
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

/** One device. The whole row is the link — there is nothing else to click. */
function LiveDeviceRow({ device }: { device: LiveDevice }) {
  const DeviceIcon = DEVICE_ICONS[device.device] ?? Globe;
  // The live view's own presence rule (filled = seen in the last 10 min), so the
  // dashboard and that page never disagree about who is here.
  const { filled } = deviceFreshness(device.lastSeenAgeSeconds);
  const browser = device.browser !== "other" ? device.browser : null;

  return (
    <Link
      href={liveHref()}
      className="group flex min-w-0 items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          filled
            ? "bg-emerald-500 motion-safe:animate-pulse dark:bg-emerald-400"
            : "bg-muted-foreground/40",
        )}
      />
      <DeviceIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium">{device.label || "This device"}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {browser && (
            <>
              <span className="shrink-0 capitalize">{browser}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="shrink-0 tabular-nums">
            {device.tabCount} tab{device.tabCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={device.lastSeenAt} className="truncate">
            {liveAgeLabel(device.lastSeenAgeSeconds)}
          </time>
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}
