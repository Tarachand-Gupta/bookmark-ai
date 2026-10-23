/** Restore is deliberately separate from saving and authentication. */
export interface RestoreBrowser {
  windows: { create(options: { url: string[] }): Promise<unknown> };
  tabs: {
    create(options: { windowId?: number; url: string; active: boolean }): Promise<{ id?: number }>;
    group?: (options: { tabIds: number[] }) => Promise<number>;
  };
  tabGroups?: { update(id: number, props: { title: string; color: string }): Promise<unknown> };
}
export type RestoreReply = { ok: true } | { ok: false; reason: "invalid" | "unsupported" | "failed" };

export function restoreCapabilities(api: RestoreBrowser) {
  return { ok: true, restoreWindow: typeof api.windows?.create === "function", tabGroups: typeof api.tabs.group === "function" };
}

export function isRestoreSender(
  sender: { id?: string; url?: string; frameId?: number; tab?: { id?: number } },
  ownId: string,
  appOrigin: string,
): boolean {
  if (sender.id !== ownId || typeof sender.tab?.id !== "number" || sender.frameId !== 0) return false;
  try { return new URL(sender.url!).origin === new URL(appOrigin).origin; } catch { return false; }
}

export function validRestoreMessage(value: unknown): value is { type: "RESTORE_SESSION"; urls: string[]; mode?: "window" | "group"; name?: string } {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return m.type === "RESTORE_SESSION" && Array.isArray(m.urls) && m.urls.length > 0 && m.urls.length <= 500
    && m.urls.every(url => {
      if (typeof url !== "string" || url.length > 8192) return false;
      try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
    }) && (m.mode === undefined || m.mode === "window" || m.mode === "group")
    && (m.name === undefined || (typeof m.name === "string" && m.name.length <= 500));
}

export async function restoreSession(api: RestoreBrowser, value: unknown, windowId?: number): Promise<RestoreReply> {
  if (!validRestoreMessage(value)) return { ok: false, reason: "invalid" };
  if (value.mode === "group" && !api.tabs.group) return { ok: false, reason: "unsupported" };
  try {
    if (value.mode === "group") {
      const ids: number[] = [];
      for (const url of value.urls) {
        const tab = await api.tabs.create({ windowId, url, active: false });
        if (typeof tab.id !== "number") throw new Error("Missing tab id");
        ids.push(tab.id);
      }
      const groupId = await api.tabs.group!({ tabIds: ids });
      try { await api.tabGroups?.update(groupId, { title: value.name || "Restored session", color: "blue" }); } catch { /* Already grouped. */ }
    } else {
      await api.windows.create({ url: value.urls });
    }
    return { ok: true };
  } catch {
    // Some tabs may already exist. The caller must not automatically retry.
    return { ok: false, reason: "failed" };
  }
}
