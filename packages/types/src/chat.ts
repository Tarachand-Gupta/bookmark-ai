import { z } from "zod";

/**
 * Chat persistence + free-tier metering API contract.
 *
 * A stored message is UIMessage-compatible: `{ id, role, parts }`, where `parts`
 * is the AI SDK's opaque `UIMessagePart[]` (text, tool calls, tool results,
 * reasoning). We do NOT re-validate the internal part shapes here — they are
 * produced and consumed by the AI SDK and stored verbatim — so `parts` is
 * `z.array(z.unknown())`.
 */

export const chatConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatConversation = z.infer<typeof chatConversationSchema>;

export const storedChatMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  parts: z.array(z.unknown()),
});
export type StoredChatMessage = z.infer<typeof storedChatMessageSchema>;

/** GET /api/chat/conversations */
export const chatConversationsResponseSchema = z.object({
  conversations: z.array(chatConversationSchema),
});
export type ChatConversationsResponse = z.infer<typeof chatConversationsResponseSchema>;

/** GET /api/chat/conversations/[id] */
export const chatConversationDetailResponseSchema = z.object({
  conversation: chatConversationSchema,
  messages: z.array(storedChatMessageSchema),
});
export type ChatConversationDetailResponse = z.infer<typeof chatConversationDetailResponseSchema>;

// ── Ask AI request protocol ───────────────────────────────────────────────────

/** Response header carrying the (possibly freshly minted) conversation id. */
export const CONVERSATION_ID_HEADER = "X-Conversation-Id";

/**
 * Response header saying which key this reply ran on. `own-fallback` = the free
 * credits are exhausted this week and a stored key took over; clients show a
 * one-line note under the reply.
 */
export const AI_SOURCE_HEADER = "X-Ai-Source";
export const chatAiSourceSchema = z.enum(["included", "own", "own-fallback"]);
export type ChatAiSource = z.infer<typeof chatAiSourceSchema>;

/** Copy for the `own-fallback` note under an assistant reply. */
export const AI_SOURCE_FALLBACK_NOTE =
  "Free credits are used up this week — running on your own key. Resets Monday.";

/**
 * Optional response header with a one-word advisory about how the reply was
 * produced. Today: `own-key-incomplete` — the user's mode is "own" but their
 * key config can't run (e.g. an OpenAI/Anthropic key with no model chosen), so
 * the INCLUDED model answered (metered). Absent when nothing needs saying.
 */
export const AI_NOTE_HEADER = "X-Ai-Note";
export const chatAiNoteSchema = z.enum(["own-key-incomplete"]);
export type ChatAiNote = z.infer<typeof chatAiNoteSchema>;

/** Copy for the `own-key-incomplete` note under an assistant reply. */
export const AI_NOTE_OWN_KEY_INCOMPLETE =
  "Your key needs a model — pick one in Settings → AI. This reply ran on the included free AI.";

// ── Ask AI attachments ────────────────────────────────────────────────────────

/**
 * The single source of truth for what may be attached to a chat message and how
 * big it may be. Every client enforces these BEFORE sending (the picker filters
 * by extension/MIME, images are downscaled to `maxEdgePx` and re-encoded) and
 * the server re-enforces them before any model call (415 / 413). Attachments
 * travel as standard AI SDK `file` UI parts with `data:` URLs on the user
 * message, so `maxTotalEncodedBytes` bounds the request body (Vercel caps
 * function bodies at 4.5 MB).
 */
export const CHAT_ATTACHMENT_RULES = {
  maxFiles: 5,
  image: {
    mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    /** What the picker may accept from disk. */
    maxSourceBytes: 10 * 1024 * 1024,
    /** Clients MUST downscale to this longest edge before encoding. */
    maxEdgePx: 1568,
    /** After downscale/re-encode; anything larger is rejected. */
    maxEncodedBytes: 2 * 1024 * 1024,
  },
  document: {
    mediaTypes: ["text/plain", "text/markdown", "text/csv", "text/html", "application/json"],
    maxBytes: 1 * 1024 * 1024,
  },
  pdf: { mediaTypes: ["application/pdf"], maxBytes: 3 * 1024 * 1024 },
  /** Sum of decoded attachment bytes per message. */
  maxTotalEncodedBytes: 4 * 1024 * 1024,
  extensionToMediaType: {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".pdf": "application/pdf",
  },
} as const;

export type ChatAttachmentKind = "image" | "document" | "pdf";

/** Rejection copy shared by every client and the server. */
export const ATTACHMENT_REJECTED_MESSAGE =
  "Only images, PDFs and text documents (.md, .txt, .csv, .json, .html) can be attached. Code and media files aren't allowed — paste the text instead.";
export const ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE = "Image is too large after compression (max 2 MB).";
export const ATTACHMENTS_TOO_LARGE_MESSAGE = "Attachments exceed 4 MB per message.";
export const ATTACHMENTS_TOO_MANY_MESSAGE = `Up to ${CHAT_ATTACHMENT_RULES.maxFiles} files per message.`;

export type ClassifiedAttachment =
  | { kind: ChatAttachmentKind; mediaType: string }
  | { kind: "rejected"; reason: string };

/** Lowercase `type/subtype` with any `;charset=…` parameters stripped, or null. */
function normalizeMediaType(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const bare = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return bare.includes("/") ? bare : null;
}

/** `.ext` (lowercased) of a filename, or null when it has none. A dotfile
 * (`.env`) counts as HAVING an (unknown) extension, so it is rejected rather
 * than falling back to whatever MIME the OS guessed. */
function extensionOf(filename: string): string | null {
  const base = filename.trim().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return null;
  return base.slice(dot).toLowerCase();
}

/** Bucket a media type into an attachment kind, or null when it isn't allowed. */
export function attachmentKindForMediaType(mediaType: string): ChatAttachmentKind | null {
  const rules = CHAT_ATTACHMENT_RULES;
  if ((rules.image.mediaTypes as readonly string[]).includes(mediaType)) return "image";
  if ((rules.document.mediaTypes as readonly string[]).includes(mediaType)) return "document";
  if ((rules.pdf.mediaTypes as readonly string[]).includes(mediaType)) return "pdf";
  return null;
}

/**
 * Decide whether a file may be attached, and as what. The EXTENSION wins when
 * the filename has one (OS MIME for `.md` is unreliable — Finder reports
 * text/plain or nothing): a known extension maps straight to its media type, an
 * unknown one is rejected outright even if the reported MIME looks harmless (so
 * `script.js` reported as text/plain is still refused). Only a filename WITHOUT
 * an extension falls back to the reported MIME (a pasted clipboard blob).
 */
export function classifyAttachment(
  filename: string,
  reportedMediaType: string | null,
): ClassifiedAttachment {
  const rejected: ClassifiedAttachment = { kind: "rejected", reason: ATTACHMENT_REJECTED_MESSAGE };
  const ext = extensionOf(filename ?? "");
  let mediaType: string | null;
  if (ext) {
    mediaType =
      (CHAT_ATTACHMENT_RULES.extensionToMediaType as Record<string, string>)[ext] ?? null;
    if (!mediaType) return rejected;
  } else {
    mediaType = normalizeMediaType(reportedMediaType);
    if (!mediaType) return rejected;
  }
  const kind = attachmentKindForMediaType(mediaType);
  return kind ? { kind, mediaType } : rejected;
}

/** Per-kind byte limit on the encoded payload. */
export function attachmentByteLimit(kind: ChatAttachmentKind): number {
  switch (kind) {
    case "image":
      return CHAT_ATTACHMENT_RULES.image.maxEncodedBytes;
    case "document":
      return CHAT_ATTACHMENT_RULES.document.maxBytes;
    case "pdf":
      return CHAT_ATTACHMENT_RULES.pdf.maxBytes;
  }
}

/** 415 body: a file of a type the allowlist refuses. */
export const attachmentTypeNotAllowedSchema = z.object({
  error: z.literal("attachment-type-not-allowed"),
  filename: z.string(),
  mediaType: z.string(),
});
export type AttachmentTypeNotAllowed = z.infer<typeof attachmentTypeNotAllowedSchema>;

/** 413 body: one attachment (or the message total) over its byte limit. */
export const attachmentsTooLargeSchema = z.object({
  error: z.literal("attachments-too-large"),
  limitBytes: z.number(),
});
export type AttachmentsTooLarge = z.infer<typeof attachmentsTooLargeSchema>;

/** The 402 body returned when the free-tier weekly token budget is exhausted. */
export const freeLimitExceededSchema = z.object({
  error: z.literal("free-limit-exceeded"),
  usedTokens: z.number(),
  limitTokens: z.number(),
});
export type FreeLimitExceeded = z.infer<typeof freeLimitExceededSchema>;

/** GET/PATCH /api/admin/ai-limit body + response. */
export const aiLimitResponseSchema = z.object({ limitTokens: z.number() });
export type AiLimitResponse = z.infer<typeof aiLimitResponseSchema>;

export const updateAiLimitSchema = z.object({
  limitTokens: z.number().int().positive().max(1_000_000_000_000),
});
export type UpdateAiLimit = z.infer<typeof updateAiLimitSchema>;
