import { browser } from "wxt/browser";
import type { SessionTab } from "@bookmark-ai/types";
import {
  isPrivateWindow,
  sessionTabsFromWindow,
  sessionTabsFromWindows,
} from "./session-filter";

/**
 * Collect open http(s) tabs as session tabs — from one window when `windowId`
 * is given (the popup's window: sessions are per-window), otherwise from every
 * normal window. Private tabs are never collected; the rules (and their tests)
 * live in ./session-filter.
 */
export async function gatherOpenTabs(windowId?: number): Promise<SessionTab[]> {
  if (windowId != null) {
    return sessionTabsFromWindow(await browser.tabs.query({ windowId }), windowId);
  }
  return sessionTabsFromWindows(await browser.windows.getAll({ populate: true }));
}

async function closeWindow(id: number): Promise<void> {
  try {
    await browser.windows.remove(id);
  } catch {
    // window already closed — ignore
  }
}

/** Defense in depth for the explicit-`windowId` close: `gatherOpenTabs` already
 * yields nothing for a private window (so a save from one errors out before it
 * ever gets here), but an id must never close a window we didn't back up. */
async function isPrivateWindowId(id: number): Promise<boolean> {
  try {
    return isPrivateWindow(await browser.windows.get(id));
  } catch {
    return false; // window already gone — the remove is a no-op anyway
  }
}

/**
 * Open `url` in a fresh window, then close the saved window — just `windowId`
 * when given, every other non-private window otherwise. The new window is
 * created first so the browser is never left with zero windows (which would
 * quit it). Called only after the session has been safely saved.
 */
export async function closeWindowsAndOpen(url: string, windowId?: number): Promise<void> {
  const keep = await browser.windows.create({ url });
  if (windowId != null) {
    if (windowId !== keep?.id && !(await isPrivateWindowId(windowId))) {
      await closeWindow(windowId);
    }
    return;
  }
  const existing = await browser.windows.getAll({ populate: false });
  for (const win of existing) {
    // Incognito windows are `type: "normal"` — without this they'd be swept up
    // by the "close everything else" walk despite never having been saved.
    if (isPrivateWindow(win)) continue;
    if (win.id != null && win.id !== keep?.id) {
      await closeWindow(win.id);
    }
  }
}
