/**
 * Best-effort handoff to the Bookmark AI browser extension. The extension can
 * do things the page can't — restoring a whole session as ONE new window with
 * every tab, where window.open gets popup-blocked after the first.
 *
 * Chrome-only mechanism (runtime.sendMessage from a web page requires the
 * extension's manifest `externally_connectable` to allow this origin). Always
 * resolves — false means "restore not confirmed, use a page-side fallback".
 */

/** Pinned public-key ids only. Prefer the store install when both coexist. */
export const RESTORE_EXTENSION_IDS = [
  "ffhbgpgebpmofjkehpjcemepbgcmoelp", // store
  "peikdeadpkgjgohdndljbciephekdpfg", // isolated production-connected Supabase QA
] as const;

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

export type RestoreMode = "window" | "group";

function messageExtension(
  runtime: NonNullable<ExternalChrome["runtime"]>,
  id: (typeof RESTORE_EXTENSION_IDS)[number],
  message: unknown,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      }
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    try {
      runtime.sendMessage(id, message, (response) => {
        // Consume lastError even for a late reply (absent install/origin denied).
        settle(!runtime.lastError && response?.ok === true);
      });
    } catch {
      settle(false);
    }
  });
}

export async function restoreSessionViaExtension(
  urls: string[],
  options: { mode?: RestoreMode; name?: string } = {},
): Promise<boolean> {
  const runtime = typeof window === "undefined"
    ? undefined
    : (window as { chrome?: ExternalChrome }).chrome?.runtime;
  if (!runtime?.sendMessage) return false;
  for (const id of RESTORE_EXTENSION_IDS) {
    // Discovery is side-effect-free. Never broadcast or retry the restore:
    // a timed-out mutating request could already have opened its window.
    if (await messageExtension(runtime, id, { type: "BOOKMARK_AI_PING" }, 1500)) {
      return messageExtension(runtime, id, {
        type: "RESTORE_SESSION", urls, mode: options.mode ?? "window", name: options.name,
      }, 800);
    }
  }
  return false;
}
