/**
 * Best-effort handoff to the Bookmark AI browser extension. The extension can
 * do things the page can't — restoring a whole session as ONE new window with
 * every tab, where window.open gets popup-blocked after the first.
 *
 * Chrome-only mechanism (runtime.sendMessage from a web page requires the
 * extension's manifest `externally_connectable` to allow this origin). Always
 * resolves — false means "extension not reachable, use a page-side fallback".
 */

/** Stable id — pinned via the CRX key in apps/extension/wxt.config.ts. */
const EXTENSION_ID = "ffhbgpgebpmofjkehpjcemepbgcmoelp";

interface ExternalChrome {
  runtime?: {
    sendMessage: (
      extensionId: string,
      message: unknown,
      callback: (response?: { ok?: boolean }) => void,
    ) => void;
    lastError?: unknown;
  };
}

export function restoreSessionViaExtension(urls: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const chrome = (window as { chrome?: ExternalChrome }).chrome;
    if (!chrome?.runtime?.sendMessage) {
      resolve(false);
      return;
    }
    let settled = false;
    const settle = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    // No response (extension installed but old version / handler missing).
    const timer = setTimeout(() => settle(false), 800);
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: "RESTORE_SESSION", urls }, (response) => {
        clearTimeout(timer);
        // lastError = extension not installed / origin not allowed.
        settle(!chrome.runtime?.lastError && response?.ok === true);
      });
    } catch {
      clearTimeout(timer);
      settle(false);
    }
  });
}
