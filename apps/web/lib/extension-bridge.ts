/** Browser-specific transport, with a single mutating restore after discovery. */
export const RESTORE_EXTENSION_IDS = [
  "ffhbgpgebpmofjkehpjcemepbgcmoelp", // store
  "peikdeadpkgjgohdndljbciephekdpfg", // isolated production-connected QA
] as const;
export type RestoreMode = "window" | "group";
export type RestoreOutcome = "restored" | "unavailable" | "unsupported" | "failed" | "unknown";
type Reply = { ok?: boolean; restoreWindow?: boolean; tabGroups?: boolean; reason?: string };
interface ExternalChrome {
  runtime?: {
    sendMessage(id: string, message: unknown, callback: (response?: Reply) => void): void;
    lastError?: unknown;
  };
}
const PAGE_CHANNEL = "bookmark-ai-session-restore-v1";
const RESTORE_TIMEOUT = 30_000;
type Send = (message: unknown, timeout: number) => Promise<Reply | undefined>;
type Connection = { send: Send; tabGroups: boolean };

function messageExtension(runtime: NonNullable<ExternalChrome["runtime"]>, id: string, message: unknown, timeout: number): Promise<Reply | undefined> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (reply?: Reply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reply);
    };
    const timer = setTimeout(() => finish(), timeout);
    try {
      runtime.sendMessage(id, message, response => finish(runtime.lastError ? undefined : response));
    } catch { finish(); }
  });
}

function messagePage(message: unknown, timeout: number): Promise<Reply | undefined> {
  if (typeof window.addEventListener !== "function" || typeof window.postMessage !== "function") return Promise.resolve(undefined);
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    const finish = (reply?: Reply) => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      resolve(reply);
    };
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.channel === PAGE_CHANNEL && data.direction === "response" && data.id === id) finish(data.response);
    };
    const timer = setTimeout(() => finish(), timeout);
    window.addEventListener("message", listener);
    window.postMessage({ channel: PAGE_CHANNEL, direction: "request", id, message }, window.location.origin);
  });
}

let discovering: Promise<Connection | null> | undefined;
async function discover(): Promise<Connection | null> {
  if (typeof window === "undefined") return null;
  const runtime = (window as { chrome?: ExternalChrome }).chrome?.runtime;
  if (runtime?.sendMessage) {
    for (const id of RESTORE_EXTENSION_IDS) {
      const reply = await messageExtension(runtime, id, { type: "BOOKMARK_AI_PING" }, 1500);
      if (reply?.ok) return { send: (message, timeout) => messageExtension(runtime, id, message, timeout), tabGroups: reply.tabGroups ?? true };
    }
    return null;
  }
  // Safari and Firefox relay through a content script restricted to the app origin.
  const reply = await messagePage({ type: "BOOKMARK_AI_PING" }, 5000);
  return reply?.ok && reply.restoreWindow ? { send: messagePage, tabGroups: reply.tabGroups === true } : null;
}
function connection(): Promise<Connection | null> {
  // Share only in-flight discovery across session cards; never memoize stale installs.
  return discovering ??= discover().finally(() => { discovering = undefined; });
}
export async function getSessionRestoreCapabilities(): Promise<{ tabGroups: boolean }> {
  const selected = await connection();
  return { tabGroups: selected?.tabGroups ?? false };
}
export async function requestSessionRestore(urls: string[], options: { mode?: RestoreMode; name?: string } = {}): Promise<RestoreOutcome> {
  const selected = await connection();
  if (!selected) return "unavailable";
  if (options.mode === "group" && !selected.tabGroups) return "unsupported";
  // Never retry or fall back after dispatch: a lost reply may have opened tabs.
  const result = await selected.send({ type: "RESTORE_SESSION", urls, mode: options.mode ?? "window", name: options.name }, RESTORE_TIMEOUT);
  if (!result) return "unknown";
  if (result.ok) return "restored";
  return result.reason === "unsupported" ? "unsupported" : "failed";
}
/** Kept for callers needing only a confirmation, never a fallback signal. */
export async function restoreSessionViaExtension(urls: string[], options: { mode?: RestoreMode; name?: string } = {}): Promise<boolean> {
  return await requestSessionRestore(urls, options) === "restored";
}

export function sessionRestoreNote(outcome: RestoreOutcome): string | null {
  switch (outcome) {
    case "restored": return null;
    case "unavailable": return "Enable or update the Bookmark AI extension in this browser, allow it on this site, then reload this page to open the whole session in one window. You can also open individual links below.";
    case "unsupported": return "This browser does not support creating tab groups from extensions. Use New window to restore this session.";
    case "unknown": return "The extension has not confirmed the restore yet. Check for a new window before trying again.";
    case "failed": return "The session could not be fully restored. Check for any tabs already opened before trying again.";
  }
}
