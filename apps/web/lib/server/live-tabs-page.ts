import type { ListLiveResponse } from "@bookmark-ai/types";
import { pageOf, TOOL_PAGE_LIMIT } from "@bookmark-ai/types";
import { clampTitle, clampUrl, matchesQuery } from "@/lib/server/chat-tool-text";

/**
 * Filtering + paging for the chat agent's `listLiveTabs` tool.
 *
 * Live state arrives NESTED (device → window → tab) but pages naturally as one
 * FLAT list, so this flattens it, filters, slices a page, then rebuilds the
 * device/window scaffolding around whatever landed on that page — the chat card
 * renders the same grouping the live view uses, and the model reads the page
 * verbatim. Pure, so it is unit-tested away from the route (a Next route module
 * may not export helpers).
 */

export const EMPTY_LIVE_PAGE = {
  total: 0,
  offset: 0,
  limit: TOOL_PAGE_LIMIT,
  hasMore: false,
  nextOffset: null,
} as const;

/** One tab, flattened with the coordinates needed to re-nest it after paging. */
interface FlatLiveTab {
  deviceIndex: number;
  windowIndex: number;
  tab: { title: string; url: string; favIconUrl: string | null };
}

/**
 * Filter → flatten → page → re-nest. Devices and windows with no tabs on this
 * page are omitted; the ones that survive carry their FULL counts, so a partial
 * group can still say "12 of 34".
 */
export function paginateLiveTabs(
  data: ListLiveResponse,
  query: string | undefined,
  limit: number,
  offset: number,
) {
  const flat: FlatLiveTab[] = [];
  const deviceMatched: number[] = [];
  data.devices.forEach((d, di) => {
    let matched = 0;
    d.windows.forEach((w, wi) => {
      w.tabs.forEach((t) => {
        if (!matchesQuery(query, t.title, t.url)) return;
        matched++;
        flat.push({
          deviceIndex: di,
          windowIndex: wi,
          tab: {
            title: clampTitle(t.title),
            url: clampUrl(t.url),
            // Favicons are for the CARD; they cost the model nothing to skip
            // over and make the rendered page recognisable at a glance.
            favIconUrl:
              typeof t.favIconUrl === "string" && t.favIconUrl.startsWith("http")
                ? clampUrl(t.favIconUrl)
                : null,
          },
        });
      });
    });
    deviceMatched[di] = matched;
  });

  const { items, page } = pageOf(flat, offset, limit);

  const devices: unknown[] = [];
  const byDevice = new Map<number, Map<number, FlatLiveTab["tab"][]>>();
  for (const f of items) {
    const wins = byDevice.get(f.deviceIndex) ?? new Map<number, FlatLiveTab["tab"][]>();
    const tabs = wins.get(f.windowIndex) ?? [];
    tabs.push(f.tab);
    wins.set(f.windowIndex, tabs);
    byDevice.set(f.deviceIndex, wins);
  }
  for (const [di, wins] of [...byDevice.entries()].sort((a, b) => a[0] - b[0])) {
    const d = data.devices[di];
    devices.push({
      label: d.label,
      browser: d.browser,
      lastSeenAgeSeconds: d.lastSeenAgeSeconds,
      /** Tabs this device has open in total (ignores the filter and the page). */
      tabCount: d.tabCount,
      /** Tabs on this device that matched the filter (ignores the page). */
      matchingTabCount: deviceMatched[di] ?? 0,
      hiddenTabCount: d.hiddenTabCount,
      windows: [...wins.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([wi, tabs]) => ({
          windowId: d.windows[wi]?.windowId,
          name: d.windows[wi]?.name ?? null,
          index: wi + 1,
          /** Tabs in this window in total, so a paged group still says "of 34". */
          windowTabCount: d.windows[wi]?.tabs.length ?? tabs.length,
          tabs,
        })),
    });
  }
  return { query: query ?? null, devices, page };
}
