"use client";

import { Fragment } from "react";
import { AppWindow } from "lucide-react";
import { hostOf } from "@/lib/chat-tools";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import { safeHref } from "@/lib/safe-href";
import { cn } from "@/lib/utils";
import {
  CardNote,
  CardToolbar,
  ShowMoreRow,
  TabFavicon,
  useExpandable,
  useTextFilter,
} from "./chat-card-parts";
import type { LiveDeviceHit, LiveTabHit, LiveTabsToolOutput, LiveWindowHit } from "./chat-tool-types";

/**
 * `listLiveTabs` as an INTERACTIVE CARD: device sections → window groups → tab
 * rows (favicon, title, host, opens in a new tab). A filter box narrows every
 * device at once and each window folds past 8 rows, so a 92-tab answer is
 * browsable in place instead of being read out as prose by the model — that is
 * the whole point (the model only ever sees a counted digest).
 */
export function LiveTabsCard({ output }: { output: LiveTabsToolOutput }) {
  const devices = output.devices ?? [];
  const allTabs = devices.flatMap((d) => (d.windows ?? []).flatMap((w) => w.tabs ?? []));
  const { query, setQuery, filtered, active } = useTextFilter(allTabs, (t) => `${t.title} ${t.url}`);
  const matched = new Set(filtered);

  if (output.error) return <CardNote>Live tabs are unavailable right now.</CardNote>;
  if (!output.enabled) {
    return (
      <CardNote>
        Live sharing is off — turn on “Live sessions” sharing in the extension to let the assistant see
        your current tabs.
      </CardNote>
    );
  }
  if (devices.length === 0) return <CardNote>No devices are sharing live tabs right now.</CardNote>;

  const totalTabs = devices.reduce((n, d) => n + (d.tabCount ?? 0), 0);
  const summary = active
    ? `${filtered.length} of ${totalTabs}`
    : `${totalTabs} tab${totalTabs === 1 ? "" : "s"} · ${devices.length} device${devices.length === 1 ? "" : "s"}`;

  return (
    <div>
      {allTabs.length > 6 && (
        <CardToolbar query={query} onQuery={setQuery} placeholder="Filter tabs by title or site…" summary={summary} />
      )}
      <ul className="divide-y">
        {devices.map((device, di) => (
          <DeviceSection key={`${device.label}-${di}`} device={device} matched={active ? matched : null} />
        ))}
      </ul>
      {active && filtered.length === 0 && <CardNote>No open tab matches “{query}”.</CardNote>}
    </div>
  );
}

/** One device: presence dot, name, browser, freshness — then its windows. */
function DeviceSection({
  device,
  matched,
}: {
  device: LiveDeviceHit;
  matched: Set<LiveTabHit> | null;
}) {
  const { filled, dim } = deviceFreshness(device.lastSeenAgeSeconds);
  const windows = (device.windows ?? []).map((w) => ({
    ...w,
    tabs: (w.tabs ?? []).filter((t) => !matched || matched.has(t)),
  }));
  const shown = windows.reduce((n, w) => n + w.tabs.length, 0);
  // A filter that excludes this device entirely hides the whole section.
  if (matched && shown === 0) return null;

  return (
    <li className={cn("px-3 py-2.5", dim && "opacity-80")}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            filled ? "bg-emerald-500" : "border border-muted-foreground/50",
          )}
        />
        <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
          {device.label || "Unnamed device"}
        </span>
        <span className="shrink-0 text-xs capitalize text-muted-foreground">{device.browser}</span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {matched ? `${shown} matching · ` : ""}
          {device.tabCount} tab{device.tabCount === 1 ? "" : "s"} · {formatDeviceAge(device.lastSeenAgeSeconds)}
        </span>
      </div>

      {windows.length === 0 || shown === 0 ? (
        <p className="mt-1 pl-4 text-[11px] text-muted-foreground">No open tabs.</p>
      ) : (
        <div className="mt-2 space-y-2 pl-1">
          {windows.map((w, wi) =>
            // A filter that matched nothing in this window drops the group
            // entirely rather than leaving an empty "0 tabs" header behind.
            matched && w.tabs.length === 0 ? null : (
              <WindowGroup key={`${w.windowId ?? wi}`} window={w} index={w.index ?? wi + 1} />
            ),
          )}
        </div>
      )}

      {device.hiddenTabCount > 0 && (
        <p className="mt-1.5 pl-1 text-[10px] text-muted-foreground">
          +{device.hiddenTabCount} tab{device.hiddenTabCount === 1 ? "" : "s"} not shared from this device
        </p>
      )}
    </li>
  );
}

/** One browser window: its label + tab count, then the tabs, folded past 8. */
function WindowGroup({ window: win, index }: { window: LiveWindowHit; index: number }) {
  const tabs = win.tabs ?? [];
  const { expanded, toggle, visibleCount, hidden } = useExpandable(tabs.length);

  return (
    <div className="rounded-md border bg-muted/10">
      <div className="flex items-center gap-1.5 border-b px-2 py-1">
        <AppWindow className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="line-clamp-1 min-w-0 text-[11px] font-medium">
          {win.name?.trim() || `Window ${index}`}
        </span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {tabs.length} tab{tabs.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-border/50">
        {tabs.slice(0, visibleCount).map((t, ti) => (
          <Fragment key={`${t.url}-${ti}`}>
            <TabRow tab={t} />
          </Fragment>
        ))}
      </ul>
      {hidden > 0 && (
        <div className="px-1.5 py-1">
          <ShowMoreRow hidden={hidden} expanded={expanded} onToggle={toggle} noun="tab" />
        </div>
      )}
    </div>
  );
}

function TabRow({ tab }: { tab: LiveTabHit }) {
  const href = safeHref(tab.url);
  const host = hostOf(tab.url);
  return (
    <li className="flex items-start gap-2 px-2 py-1.5 transition-colors hover:bg-muted/50">
      <TabFavicon src={tab.favIconUrl} url={tab.url} />
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={tab.url}
            className="line-clamp-1 text-xs font-medium hover:underline [overflow-wrap:anywhere]"
          >
            {tab.title || tab.url}
          </a>
        ) : (
          <span className="line-clamp-1 text-xs font-medium [overflow-wrap:anywhere]">
            {tab.title || tab.url}
          </span>
        )}
        <p className="line-clamp-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{host}</p>
      </div>
    </li>
  );
}
