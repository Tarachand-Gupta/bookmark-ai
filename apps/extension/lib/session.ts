import { browser } from "wxt/browser";
import type { SessionTab } from "@bookmark-ai/types";

/** Collect every open http(s) tab across all normal windows as session tabs. */
export async function gatherOpenTabs(): Promise<SessionTab[]> {
  const windows = await browser.windows.getAll({ populate: true });
  const tabs: SessionTab[] = [];
  for (const win of windows) {
    if (win.type && win.type !== "normal") continue; // skip devtools/popup windows
    for (const t of win.tabs ?? []) {
      if (!t.url || !/^https?:/i.test(t.url)) continue; // only restorable tabs
      tabs.push({
        url: t.url,
        title: t.title ?? "",
        favIconUrl: t.favIconUrl,
        windowId: win.id,
      });
    }
  }
  return tabs;
}

/**
 * Open `url` in a fresh window, then close every other normal window. The new
 * window is created first so the browser is never left with zero windows
 * (which would quit it). Called only after the session has been safely saved.
 */
export async function closeWindowsAndOpen(url: string): Promise<void> {
  const existing = await browser.windows.getAll({ populate: false });
  const keep = await browser.windows.create({ url });
  for (const win of existing) {
    if (win.id != null && win.id !== keep?.id) {
      try {
        await browser.windows.remove(win.id);
      } catch {
        // window already closed — ignore
      }
    }
  }
}
