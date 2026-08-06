import type {
  NewTabActiveContext,
  NewTabSettings,
  NewTabTemplate,
  NewTabWizardData,
  UpdateNewTabSettingsInput,
} from "@bookmark-ai/types";
import { requestApiProxy } from "@/lib/messages";

/**
 * The newtab page's client for /api/newtab/* (+ the wizard bundle and /api/chat).
 * Every call goes through the BACKGROUND (the API_PROXY message) — the page is
 * a trusted extension page but holds NO token: page-context Clerk syncHost can't
 * see the production session (HttpOnly client cookie lives on the FAPI domain),
 * so the background's auth ladder (device token first — survives the ~7-day
 * server-side session expiry) provides auth. See lib/messages.ts API_PROXY.
 */

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await requestApiProxy(
    init?.method ?? "GET",
    path,
    init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  );
  if (res.status === 204 || res.status === 0) {
    if (res.status === 204) return undefined as T;
    throw new ApiError(0, "Couldn't reach the extension background.");
  }
  let body: Record<string, unknown> = {};
  try {
    body = res.bodyJson ? (JSON.parse(res.bodyJson) as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(res.status, "Bad response from the API.");
  }
  if (res.status >= 400) {
    throw new ApiError(res.status, (body.error as string | undefined) ?? `Request failed (${res.status})`);
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
    body: patch,
  });
  return data.settings;
}

export async function activateTemplate(id: string): Promise<NewTabTemplate> {
  const data = await api<{ template: NewTabTemplate }>(
    `/api/newtab/templates/${encodeURIComponent(id)}/activate`,
    { method: "POST", body: {} },
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
 * surface to the app for the hot-swap). The proxy buffers the whole stream and
 * returns it as text; we parse the `data: {json}` SSE frames out of it. */

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
  const res = await requestApiProxy(
    "POST",
    "/api/chat",
    JSON.stringify({
      messages: input.messages,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.activeContext ? { activeContext: input.activeContext } : {}),
    }),
  );
  if (!res.ok || res.status === 0) {
    throw new ApiError(0, "Couldn't reach the extension background.");
  }
  if (res.status >= 400) {
    let msg = `Chat failed (${res.status})`;
    try {
      msg = (JSON.parse(res.bodyJson ?? "") as { error?: string }).error ?? msg;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, msg);
  }

  const conversationId = res.headers?.["x-conversation-id"] ?? null;
  const raw = res.bodyJson ?? "";
  let text = "";
  let template: NewTabTemplate | null = null;
  const toolNames = new Map<string, string>();

  for (const frame of raw.split("\n\n")) {
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
  return { text, conversationId, template };
}
