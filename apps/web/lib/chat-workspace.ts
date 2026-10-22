import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { chatContextSchema, type ChatContext } from "@bookmark-ai/types";

export type DraftFile = FileUIPart & { id: string };
export type MissingDraftFile = { id: string; filename: string; mediaType: string };
export interface ChatDraft {
  key: string;
  conversationId: string | null;
  title: string;
  text: string;
  files: DraftFile[];
  missingFiles: MissingDraftFile[];
  context: ChatContext;
  updatedAt: string;
  interrupted: boolean;
}
export interface WorkspaceThread extends ChatDraft {
  chat: Chat<UIMessage>;
  source: string | null;
  note: string | null;
  limit: { usedTokens?: number; limitTokens?: number } | null;
  rejection: string | null;
  sourceByMessage: Map<string, string>;
  noteByMessage: Map<string, string>;
  pending: { text: string; files: DraftFile[]; context: ChatContext } | null;
  recoverable: { text: string; files: DraftFile[]; context: ChatContext } | null;
  lastSubmittedContext: ChatContext | null;
  recoverableMissingFiles?: MissingDraftFile[];
}
type StoredDraft = ChatDraft & { recoverable?: { text: string; context: ChatContext; missingFiles: MissingDraftFile[] } };
type StoredWorkspace = { version: 1; accountId: string; activeKey: string; drafts: StoredDraft[] };
export const workspaceStorageKey = (accountId: string) => `bmai:composer:v1:${accountId}`;
const id = () => globalThis.crypto.randomUUID();

/** Disk holds text, context and file descriptors only. Bytes are session-local. */
export function serializeDrafts(accountId: string, activeKey: string, drafts: StoredDraft[]): string {
  return JSON.stringify({ version: 1, accountId, activeKey, drafts: drafts.map(draft => ({
    key: draft.key, conversationId: draft.conversationId, title: draft.title, text: draft.text, context: draft.context, updatedAt: draft.updatedAt, interrupted: draft.interrupted,
    ...(draft.recoverable ? { recoverable: { text: draft.recoverable.text, context: draft.recoverable.context, missingFiles: draft.recoverable.missingFiles } } : {}),
    files: [],
    missingFiles: [...draft.missingFiles, ...draft.files.map(file => ({ id: file.id, filename: file.filename ?? "Attachment", mediaType: file.mediaType }))],
  })) } satisfies StoredWorkspace);
}

export function restoreDrafts(raw: string | null, accountId: string): StoredWorkspace | null {
  try {
    const stored = JSON.parse(raw ?? "null") as StoredWorkspace | null;
    if (!stored || stored.version !== 1 || stored.accountId !== accountId || !Array.isArray(stored.drafts)) return null;
    const drafts = stored.drafts.filter(d => typeof d.key === "string" && typeof d.text === "string" && d.text.length <= 32000 && (d.conversationId === null || typeof d.conversationId === "string") && chatContextSchema.safeParse(d.context).success).map(d => ({
      ...d, files: [], missingFiles: Array.isArray(d.missingFiles) ? d.missingFiles.filter(f => typeof f.id === "string" && typeof f.filename === "string" && typeof f.mediaType === "string") : [],
    }));
    return { ...stored, drafts, activeKey: drafts.some(d => d.key === stored.activeKey) ? stored.activeKey : drafts[0]?.key ?? "" };
  } catch { return null; }
}

export function contextLabel(context: ChatContext): string {
  switch (context.type) {
    case "library": return "Your library";
    case "bookmarks": return `${context.bookmarkIds.length} selected bookmark${context.bookmarkIds.length === 1 ? "" : "s"}`;
    case "folder": return "Folder context";
    case "page": return context.title || new URL(context.url).hostname;
    case "session": return "Saved session";
    case "live_window": return "Shared window";
  }
}

/** One account owns all chat instances. Presentations only subscribe; closing
 * or switching the visible thread never stops any accepted response. */
export class ChatWorkspace {
  readonly threads = new Map<string, WorkspaceThread>();
  activeKey = "";
  revision = 0;
  private listeners = new Set<() => void>();
  private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private disposed = false;
  onFinish?: (message: UIMessage) => void;
  constructor(readonly accountId: string, private headers: () => Promise<Record<string, string>>) { this.create(); }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.revision;
  get active() { return this.threads.get(this.activeKey)!; }
  notify = () => { if (this.disposed) return; this.revision++; this.persist(); this.listeners.forEach(fn => fn()); };
  hydrate(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    if (this.storage) return;
    this.storage = storage;
    let stored: StoredWorkspace | null = null;
    try { stored = restoreDrafts(storage.getItem(workspaceStorageKey(this.accountId)), this.accountId); } catch { /* Restricted storage keeps an in-memory workspace. */ }
    if (stored?.drafts.length) {
      this.threads.clear();
      for (const draft of stored.drafts) this.create(draft);
      this.activeKey = stored.activeKey;
    }
    this.notify();
  }
  private persist() {
    if (!this.storage) return;
    try { this.storage.setItem(workspaceStorageKey(this.accountId), serializeDrafts(this.accountId, this.activeKey, [...this.threads.values()].map(t => ({
      key: t.key, conversationId: t.conversationId, title: t.title, text: t.text || t.pending?.text || "", files: t.files.length ? t.files : t.pending?.files ?? [], missingFiles: t.missingFiles,
      recoverable: t.recoverable ? { text: t.recoverable.text, context: t.recoverable.context, missingFiles: [...(t.recoverableMissingFiles ?? []), ...t.recoverable.files.map(f => ({ id: f.id, filename: f.filename ?? "Attachment", mediaType: f.mediaType }))] } : undefined,
      context: t.context, updatedAt: t.updatedAt, interrupted: t.interrupted || t.chat.status === "streaming" || t.chat.status === "submitted",
    })))); } catch { /* Storage full/disabled: the active-session draft remains. */ }
  }
  create(draft?: Partial<StoredDraft>) {
    if (this.disposed) return this.active;
    const thread = {
      key: draft?.key ?? `draft:${id()}`, conversationId: draft?.conversationId ?? null, title: draft?.title ?? "New conversation",
      text: draft?.text ?? "", files: draft?.files ?? [], missingFiles: draft?.missingFiles ?? [], context: draft?.context ?? { type: "library" }, updatedAt: draft?.updatedAt ?? new Date().toISOString(), interrupted: draft?.interrupted ?? false,
      source: null, note: null, limit: null, rejection: null, sourceByMessage: new Map(), noteByMessage: new Map(), pending: null, recoverable: null, lastSubmittedContext: null,
    } as WorkspaceThread;
    const transport = new DefaultChatTransport<UIMessage>({
      api: "/api/chat",
      fetch: async (input, init) => {
        const headers = await this.headers();
        if (this.disposed) throw new Error("This account's conversation is no longer active.");
        const response = await fetch(input, { ...init, headers: { ...init?.headers as Record<string, string>, ...headers } });
        if (this.disposed) return response;
        thread.conversationId = response.headers.get("X-Conversation-Id") ?? thread.conversationId;
        thread.source = response.headers.get("X-Ai-Source");
        thread.note = response.headers.get("X-Ai-Note");
        if (!response.ok) {
          const body = await response.clone().json().catch(() => null);
          if (response.status === 402 && body?.error === "free-limit-exceeded") thread.limit = body;
          if ([400, 413, 415].includes(response.status) && String(body?.error).includes("attachment")) thread.rejection = body?.error;
          if (response.status === 401) window.dispatchEvent(new Event("bookmark-auth-rejected"));
        }
        this.notify();
        return response;
      },
      prepareSendMessagesRequest: ({ messages, trigger }) => {
        let timezone: string | undefined;
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* optional */ }
        const common = { conversationId: thread.conversationId ?? undefined, timezone, context: thread.pending?.context ?? (trigger === "regenerate-message" ? thread.lastSubmittedContext : null) ?? thread.context };
        return { body: thread.conversationId && trigger === "submit-message" ? { message: messages.at(-1), ...common } : { messages, ...common } };
      },
    });
    thread.chat = new Chat({
      id: thread.key, transport,
      onFinish: ({ message, isAbort, isError }) => {
        if (this.disposed) return;
        if (thread.source) thread.sourceByMessage.set(message.id, thread.source);
        if (thread.note) thread.noteByMessage.set(message.id, thread.note);
        thread.interrupted = isAbort;
        if (!isError) thread.pending = null;
        this.onFinish?.(message);
        this.notify();
      },
      onError: () => { this.recover(thread); },
    });
    thread.chat["~registerStatusCallback"](() => this.notify());
    if (draft?.recoverable && typeof draft.recoverable.text === "string" && chatContextSchema.safeParse(draft.recoverable.context).success) {
      // Keep a recovered failed turn as its own draft; it must not replace newer text.
      thread.recoverable = { text: draft.recoverable.text, context: draft.recoverable.context, files: [] };
      thread.recoverableMissingFiles = draft.recoverable.missingFiles ?? [];
    }
    this.threads.set(thread.key, thread);
    this.activeKey = thread.key;
    this.notify();
    return thread;
  }
  patch(patch: Partial<Pick<ChatDraft, "text" | "files" | "missingFiles" | "context" | "title" | "interrupted">>, key = this.activeKey) {
    const thread = this.threads.get(key); if (!thread || this.disposed) return;
    if (patch.text !== undefined && !thread.conversationId && !thread.chat.messages.length) thread.title = patch.text.trim().slice(0, 80) || "New conversation";
    Object.assign(thread, patch, { updatedAt: new Date().toISOString() }); this.notify();
  }
  select(key: string) { if (this.threads.has(key)) { this.activeKey = key; this.notify(); } }
  findConversation(conversationId: string) { return [...this.threads.values()].find(t => t.conversationId === conversationId); }
  send(text = this.active.text, files: FileUIPart[] = this.active.files) {
    const thread = this.active;
    if (this.disposed || thread.chat.status === "streaming" || thread.chat.status === "submitted" || thread.pending || thread.missingFiles.length || (!text.trim() && !files.length)) return;
    thread.pending = { text, files: files.map((f, index) => ({ ...f, id: thread.files[index]?.id ?? id() })), context: structuredClone(thread.context) };
    thread.lastSubmittedContext = thread.pending.context;
    thread.text = ""; thread.files = []; thread.limit = null; thread.rejection = null; thread.interrupted = false;
    if (!thread.conversationId) thread.title = text.trim().slice(0, 80) || files[0]?.filename || "Attachment";
    thread.chat.clearError(); this.notify();
    void thread.chat.sendMessage({ ...(text.trim() ? { text: text.trim() } : {}), files, metadata: { context: structuredClone(thread.pending.context) } }).catch(() => this.recover(thread));
  }
  private recover(thread: WorkspaceThread) {
    if (this.disposed || !thread.pending) return;
    if (!thread.text && !thread.files.length) {
      thread.text = thread.pending.text; thread.files = thread.pending.files; thread.context = thread.pending.context;
    } else thread.recoverable = thread.pending;
    thread.pending = null;
    this.notify();
  }
  recoverFailedTurn(key = this.activeKey) {
    const thread = this.threads.get(key);
    if (!thread?.recoverable || this.disposed) return;
    const recovered = thread.recoverable;
    const missingFiles = thread.recoverableMissingFiles ?? [];
    thread.recoverable = null; thread.recoverableMissingFiles = [];
    this.create({ text: recovered.text, files: recovered.files, context: recovered.context, missingFiles, title: "Recovered draft" });
  }
  discardFailedTurn(key = this.activeKey) {
    const thread = this.threads.get(key); if (!thread) return;
    thread.recoverable = null; thread.recoverableMissingFiles = []; this.notify();
  }
  attach(files: DraftFile[], key: string) {
    const thread = this.threads.get(key); if (!thread || this.disposed) return;
    const available = [...files];
    const missingFiles = thread.missingFiles.filter(missing => { const index = available.findIndex(file => file.filename === missing.filename && file.mediaType === missing.mediaType); if (index < 0) return true; available.splice(index, 1); return false; });
    this.patch({ files, missingFiles }, key);
  }
  get isActive() { return !this.disposed; }
  activate() { this.disposed = false; }
  dispose() {
    if (this.disposed) return;
    this.persist(); this.disposed = true;
    for (const thread of this.threads.values()) void thread.chat.stop();
  }
  remove(key: string) {
    const thread = this.threads.get(key); if (!thread) return;
    void thread.chat.stop(); this.threads.delete(key);
    if (key === this.activeKey) { this.activeKey = this.threads.keys().next().value ?? ""; if (!this.activeKey) this.create(); }
    this.notify();
  }
  clearPrivateData() {
    this.dispose();
    try { this.storage?.removeItem(workspaceStorageKey(this.accountId)); } catch { /* Already unavailable. */ }
    this.listeners.clear();
  }
}
