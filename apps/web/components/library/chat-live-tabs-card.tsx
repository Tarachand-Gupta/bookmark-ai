"use client";

import { useCallback } from "react";
import { AppWindow } from "lucide-react";
import { getLive } from "@/lib/api";
import { hostOf } from "@/lib/chat-tools";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import { safeHref } from "@/lib/safe-href";
import { cn } from "@/lib/utils";
import {
  CardNote,
  CardToolbar,
  PageFooter,
  ShowMoreRow,
  TabFavicon,
  useExpandable,
  useTextFilter,
  useToolPaging,
} from "./chat-card-parts";
import type {
  LiveDeviceHit,
  LiveTabHit,
  LiveTabsToolOutput,
  LiveWindowHit,
  ToolPageMeta,
} from "./chat-tool-types";

/**
 * `listLiveTabs` as an INTERACTIVE CARD: device sections → window groups → tab
 * rows (favicon, title, host, opens in a new tab). The tool returns ONE PAGE of
 * tabs (flat order, re-nested into its device/window scaffolding), so the card
 * shows exactly what the model read and offers "Load next 50" to fetch more
 * without a model turn. A filter box narrows what's loaded, and each window
 * folds past ~10 rows, opening 25 at a time — a 92-tab device stays browsable
 * instead of being read out as prose.
 */
export function LiveTabsCard({ output }: { output: LiveTabsToolOutput }) {
  const toolQuery = output.query ?? undefined;

  // The live server hands back the whole current snapshot in one call, so a
  // later page is the same flatten → filter → slice the tool did, client-side.
  const fetchPage = useCallback(
    async (offset: number, limit: number): Promise<{ rows: FlatTab[]; page: ToolPageMeta }> => {
      const live = await getLive();
      const flat: FlatTab[] = [];
      const q = toolQuery?.trim().toLowerCase();
      for (const d of live.devices) {
        d.windows.forEach((w, wi) => {
          for (const t of w.tabs) {
            if (q && !`${t.title} ${t.url}`.toLowerCase().includes(q)) continue;
            flat.push({
              device: {
                label: d.label,
                browser: d.browser,
                lastSeenAgeSeconds: d.lastSeenAgeSeconds,
                tabCount: d.tabCount,
                hiddenTabCount: d.hiddenTabCount,
                windows: [],
              },
              windowId: w.windowId,
              windowName: w.name ?? null,
              windowIndex: wi + 1,
              windowTabCount: w.tabs.length,
              tab: { title: t.title, url: t.url, favIconUrl: t.favIconUrl ?? null },
            });
          }
        });
      }
      const slice = flat.slice(offset, offset + limit);
      const hasMore = flat.length > offset + limit;
      return {
        rows: slice,
        page: { total: flat.length, offset, limit, hasMore, nextOffset: hasMore ? offset + limit : null },
      };
    },
    [toolQuery],
  );

  const { rows, page, loading, error, loadMore } = useToolPaging(
    flatten(output.devices ?? []),
    output.page,
    fetchPage,
  );
  const { query, setQuery, filtered, active } = useTextFilter(rows, (r) => `${r.tab.title} ${r.tab.url}`);

  if (output.error) return <CardNote>Live tabs are unavailable right now.</CardNote>;
  if (!output.enabled) {
    return (
      <CardNote>
        Live sharing is off — turn on “Live sessions” sharing in the extension to let the assistant see
        your current tabs.
      </CardNote>
    );
  }
  if (rows.length === 0) {
    return (
      <CardNote>
        {toolQuery
          ? `No open tab matches “${toolQuery}”.`
          : "No devices are sharing live tabs right now."}
      </CardNote>
    );
  }

  const devices = regroup(filtered);
  const deviceCount = new Set(rows.map((r) => r.device.label)).size;
  const summary = active
    ? `${filtered.length} of ${rows.length}`
    : `${page?.total ?? rows.length} tab${(page?.total ?? rows.length) === 1 ? "" : "s"} · ${deviceCount} device${deviceCount === 1 ? "" : "s"}`;

  return (
    <div>
      {rows.length > 6 && (
        <CardToolbar query={query} onQuery={setQuery} placeholder="Filter tabs by title or site…" summary={summary} />
      )}
      <ul className="divide-y">
        {devices.map((device, di) => (
          <DeviceSection key={`${device.label}-${di}`} device={device} />
        ))}
      </ul>
      {active && filtered.length === 0 && <CardNote>No loaded tab matches “{query}”.</CardNote>}
      <PageFooter
        page={page}
        firstOffset={output.page?.offset ?? 0}
        shown={rows.length}
        noun="tabs"
        loading={loading}
        error={error}
        onLoadMore={loadMore}
      />
    </div>
  );
}

/**
 * One tab plus the device/window it belongs to. Paging happens over this FLAT
 * order (matching the server's), and the sections are rebuilt from whatever is
 * loaded — so "load more" appends into the right groups instead of restarting.
 */
interface FlatTab {
  device: LiveDeviceHit;
  windowId?: number;
  windowName: string | null;
  windowIndex: number;
  windowTabCount: number;
  tab: LiveTabHit;
}

function flatten(devices: LiveDeviceHit[]): FlatTab[] {
  const out: FlatTab[] = [];
  for (const d of devices) {
    for (const w of d.windows ?? []) {
      for (const t of w.tabs ?? []) {
        out.push({
          device: d,
          windowId: w.windowId,
          windowName: w.name ?? null,
          windowIndex: w.index ?? 1,
          windowTabCount: w.windowTabCount ?? (w.tabs ?? []).length,
          tab: t,
        });
      }
    }
  }
  return out;
}

/** Flat tabs → device sections → window groups, preserving first-seen order. */
function regroup(flat: readonly FlatTab[]): (LiveDeviceHit & { loadedTabCount: number })[] {
  const byDevice = new Map<string, LiveDeviceHit & { loadedTabCount: number }>();
  const windows = new Map<string, Map<string, LiveWindowHit>>();
  for (const f of flat) {
    const dKey = f.device.label;
    let device = byDevice.get(dKey);
    if (!device) {
      device = { ...f.device, windows: [], loadedTabCount: 0 };
      byDevice.set(dKey, device);
      windows.set(dKey, new Map());
    }
    device.loadedTabCount++;
    const wKey = String(f.windowId ?? f.windowIndex);
    const wins = windows.get(dKey)!;
    let win = wins.get(wKey);
    if (!win) {
      win = {
        windowId: f.windowId,
        name: f.windowName,
        index: f.windowIndex,
        windowTabCount: f.windowTabCount,
        tabs: [],
      };
      wins.set(wKey, win);
      device.windows.push(win);
    }
    win.tabs.push(f.tab);
  }
  return [...byDevice.values()];
}

/** One device: presence dot, name, browser, freshness — then its windows. */
function DeviceSection({ device }: { device: LiveDeviceHit & { loadedTabCount: number } }) {
  const { filled, dim } = deviceFreshness(device.lastSeenAgeSeconds);
  const partial = device.loadedTabCount < device.tabCount;

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
          {partial ? `${device.loadedTabCount} of ${device.tabCount} tabs` : `${device.tabCount} tab${device.tabCount === 1 ? "" : "s"}`}
          {" · "}
          {formatDeviceAge(device.lastSeenAgeSeconds)}
        </span>
      </div>

      {/* Window groups are shown even for a single window — the header carries
          the window's name and its own tab count, which is how the live view
          identifies "the window I was working in". */}
      <div className="mt-2 space-y-2 pl-1">
        {device.windows.map((w, wi) => (
          <WindowGroup key={`${w.windowId ?? wi}`} window={w} index={w.index ?? wi + 1} />
        ))}
      </div>

      {device.hiddenTabCount > 0 && (
        <p className="mt-1.5 pl-1 text-[10px] text-muted-foreground">
          {device.hiddenTabCount} tab{device.hiddenTabCount === 1 ? "" : "s"} on this device{" "}
          {device.hiddenTabCount === 1 ? "is" : "are"} in windows that aren’t shared to live sessions
        </p>
      )}
    </li>
  );
}

/** One browser window: its label + tab count, then the tabs, folded past ~10. */
function WindowGroup({ window: win, index }: { window: LiveWindowHit; index: number }) {
  const tabs = win.tabs ?? [];
  const total = win.windowTabCount ?? tabs.length;
  const { expanded, toggle, visibleCount, hidden, nextChunk } = useExpandable(tabs.length);

  return (
    <div className="rounded-md border bg-muted/10">
      <div className="flex items-center gap-1.5 border-b px-2 py-1">
        <AppWindow className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="line-clamp-1 min-w-0 text-[11px] font-medium">
          {win.name?.trim() || `Window ${index}`}
        </span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {tabs.length < total ? `${tabs.length} of ${total} tabs` : `${total} tab${total === 1 ? "" : "s"}`}
        </span>
      </div>
      <ul className="divide-y divide-border/50">
        {tabs.slice(0, visibleCount).map((t, ti) => (
          <TabRow key={`${t.url}-${ti}`} tab={t} />
        ))}
      </ul>
      {hidden > 0 && (
        <div className="px-1.5 py-1">
          <ShowMoreRow hidden={hidden} expanded={expanded} onToggle={toggle} noun="tab" nextChunk={nextChunk} />
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
