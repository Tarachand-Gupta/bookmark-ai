import type {
  NewTabActiveContext,
  NewTabSettings,
  NewTabTemplate,
  NewTabWizardData,
  UpdateNewTabSettingsInput,
} from "@bookmark-ai/types";
import { authFetch, getApiBaseUrl } from "@/lib/api";

/**
 * The newtab page's client for /api/newtab/* (+ the wizard bundle and /api/chat).
 * Plain authed fetch via lib/api.ts — the page context registers a Clerk
 * session-token provider at boot (main.tsx), so these ride the same session
 * the popup mirrors. No device-token involvement: a page can host the full
 * SDK, unlike the background worker.
 */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBaseUrl();
  const res = await authFetch(`${base}${path}`, {
    headers: { "content-type": "application/json", accept: "application/json" },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchTemplates(): Promise<NewTabTemplate[]> {
  const data = await api<{ templates: NewTabTemplate[] }>("/api/newtab/templates");
  return data.templates;
}

export async function fetchNewTabSettings(): Promise<NewTabSettings | null> {
  const data = await api<{ settings: NewTabSettings | null }>("/api/newtab/settings");
  return data.settings;
}

export async function patchNewTabSettings(
  patch: UpdateNewTabSettingsInput,
): Promise<NewTabSettings> {
  const data = await api<{ settings: NewTabSettings }>("/api/newtab/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.settings;
}

export async function activateTemplate(id: string): Promise<NewTabTemplate> {
  const data = await api<{ template: NewTabTemplate }>(
    `/api/newtab/templates/${encodeURIComponent(id)}/activate`,
    { method: "POST", body: "{}" },
  );
  return data.template;
}

export async function deleteTemplate(id: string): Promise<void> {
  await api<void>(`/api/newtab/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchWizard(): Promise<NewTabWizardData> {
  return api<NewTabWizardData>("/api/newtab/wizard");
}

/* ── Chat (new-tab popover + wizard) ────────────────────────────────────────
 * Minimal hand-rolled UI-message-stream client — the extension has no AI-SDK
 * React dep, and we only need: accumulated assistant text, the conversation id
 * header, and whether writeNewTabTemplate produced a template (whose output we
 * surface to the app for the hot-swap). */

export interface ChatSendInput {
  messages: { id: string; role: "user"; parts: { type: "text"; text: string }[] }[];
  conversationId?: string;
  activeContext?: NewTabActiveContext;
}

export interface ChatSendResult {
  text: string;
  conversationId: string | null;
  /** Set when the agent's writeNewTabTemplate tool completed with a template. */
  template: NewTabTemplate | null;
}

export async function sendChat(input: ChatSendInput): Promise<ChatSendResult> {
  const base = await getApiBaseUrl();
  const res = await authFetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      messages: input.messages,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.activeContext ? { activeContext: input.activeContext } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error ?? `Chat failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  const conversationId = res.headers.get("x-conversation-id");
  let text = "";
  let template: NewTabTemplate | null = null;
  const toolNames = new Map<string, string>();

  // Parse `data: {json}` SSE frames.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        const type = event.type;
        if (type === "text-delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (type === "tool-input-available") {
          toolNames.set(String(event.toolCallId), String(event.toolName ?? ""));
        } else if (type === "tool-output-available") {
          const name = toolNames.get(String(event.toolCallId)) ?? "";
          const output = event.output as { template?: NewTabTemplate } | undefined;
          if (name === "writeNewTabTemplate" && output?.template) {
            template = output.template;
          }
        }
      }
    }
  }
  return { text, conversationId, template };
}
