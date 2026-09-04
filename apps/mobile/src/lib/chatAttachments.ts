import {
  ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE,
  ATTACHMENTS_TOO_LARGE_MESSAGE,
  ATTACHMENTS_TOO_MANY_MESSAGE,
  CHAT_ATTACHMENT_RULES,
  attachmentKindForMediaType,
  type ChatAttachmentKind,
} from "@bookmark-ai/types";
import type { FileUIPart } from "ai";
import type { SymbolViewProps } from "expo-symbols";

/**
 * Attachment policy for Ask AI, as pure functions — the phone-side half of the
 * contract in packages/types/src/chat.ts (`CHAT_ATTACHMENT_RULES`,
 * `classifyAttachment`). Everything that touches a picker, the file system or an
 * image encoder lives in ./attachmentPickers.ts; this module only decides and
 * measures, so it runs under plain Node for the unit tests.
 */

/** A file staged in the composer: validated, downscaled/encoded, waiting for Send. */
export interface PendingAttachment {
  /** Local key for the pill list (remove ×). Not sent. */
  id: string;
  kind: ChatAttachmentKind;
  filename: string;
  mediaType: string;
  /** `data:<mediaType>;base64,…` — exactly what goes on the wire as the part's `url`. */
  url: string;
  /** Decoded payload size in bytes (the per-kind limits are measured on this). */
  bytes: number;
  /** Pixel size, images only — lets a thumbnail reserve the right aspect. */
  width?: number;
  height?: number;
}

/** Wire shape of one attachment on the user message (a standard AI SDK file part). */
export function toFileParts(items: readonly PendingAttachment[]): FileUIPart[] {
  return items.map((item) => ({
    type: "file",
    mediaType: item.mediaType,
    filename: item.filename,
    url: item.url,
  }));
}

/**
 * Send is live when there is a question OR at least one staged file — files on
 * their own are a message (the web allows it too; the server titles the
 * conversation from the filename).
 */
export function canSendTurn(text: string, fileCount: number): boolean {
  return text.trim().length > 0 || fileCount > 0;
}

/** The two shapes the AI SDK's `sendMessage` takes: a question (optionally with
 * files), or files on their own. There is no third shape with an empty text. */
export type ChatSendPayload = { text: string; files?: FileUIPart[] } | { files: FileUIPart[] };

/**
 * What `sendMessage` gets for a turn. An empty question is OMITTED rather than
 * sent as an empty text part — a `{ text: "" }` part reaches the model as a
 * blank user turn and leaves the server nothing to title the conversation with
 * but "New chat", where the filename should be. Null when there is nothing to
 * send at all.
 */
export function sendPayload(text: string, files?: readonly FileUIPart[]): ChatSendPayload | null {
  const trimmed = text.trim();
  const staged = files ?? [];
  if (!canSendTurn(trimmed, staged.length)) return null;
  if (staged.length === 0) return { text: trimmed };
  return trimmed ? { text: trimmed, files: [...staged] } : { files: [...staged] };
}

export function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** Decoded byte length of a base64 string — honours `=` padding, tolerates whitespace. */
export function base64ByteLength(base64: string): number {
  const s = base64.replace(/\s+/g, "");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

/**
 * Bytes a `data:` URL puts on the WIRE: the length of its base64 payload. The
 * 4 MB per-message cap exists because Vercel refuses request bodies over 4.5 MB,
 * and the body carries base64 — so the total is measured on the encoded text,
 * not the decoded bytes (stricter than a decoded count by 4/3, never looser).
 */
export function dataUrlPayloadLength(url: string): number {
  const comma = url.indexOf(",");
  return comma === -1 ? 0 : url.length - comma - 1;
}

export function totalPayloadBytes(items: readonly { url: string }[]): number {
  return items.reduce((sum, item) => sum + dataUrlPayloadLength(item.url), 0);
}

/** How many more files the composer may take (max 5 per message). */
export function remainingSlots(existing: readonly PendingAttachment[]): number {
  return Math.max(0, CHAT_ATTACHMENT_RULES.maxFiles - existing.length);
}

/**
 * Admit newly picked files into the staged set under the per-message caps: at
 * most `maxFiles`, and a total base64 payload ≤ `maxTotalEncodedBytes`. Takes
 * what fits, in order; `rejected` carries the contract copy for the LAST rule
 * that refused something, so the user learns why a pick didn't all land.
 */
export function acceptAttachments(
  existing: readonly PendingAttachment[],
  incoming: readonly PendingAttachment[],
): { accepted: PendingAttachment[]; rejected: string | null } {
  const accepted: PendingAttachment[] = [];
  let rejected: string | null = null;
  let count = existing.length;
  let total = totalPayloadBytes(existing);
  for (const item of incoming) {
    if (count >= CHAT_ATTACHMENT_RULES.maxFiles) {
      rejected = ATTACHMENTS_TOO_MANY_MESSAGE;
      continue;
    }
    const size = dataUrlPayloadLength(item.url);
    if (total + size > CHAT_ATTACHMENT_RULES.maxTotalEncodedBytes) {
      rejected = ATTACHMENTS_TOO_LARGE_MESSAGE;
      continue;
    }
    accepted.push(item);
    count += 1;
    total += size;
  }
  return { accepted, rejected };
}

/** Rejection copy for a picked file over its kind's byte limit. The image line is
 * the contract's; documents/PDFs have no verbatim copy, so they follow its shape. */
export function tooLargeMessage(kind: ChatAttachmentKind, limitBytes: number): string {
  switch (kind) {
    case "image":
      return ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE;
    case "pdf":
      return `PDF is too large (max ${formatBytes(limitBytes)}).`;
    case "document":
      return `Document is too large (max ${formatBytes(limitBytes)}).`;
  }
}

/** A source image the picker may not even accept (10 MB from disk). */
export const IMAGE_SOURCE_TOO_LARGE_MESSAGE = `Image is too large (max ${formatBytes(
  CHAT_ATTACHMENT_RULES.image.maxSourceBytes,
)}).`;

/**
 * A picker failure whose `message` is already the line to show the user. Any
 * other throw is an unexpected one and gets the caller's generic copy instead —
 * a raw exception message is never put in front of a person.
 */
export class PickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickerError";
  }
}

/** Generic failures, one per picker. */
export const PHOTO_LIBRARY_FAILED_MESSAGE = "Couldn't open your photo library.";
export const FILES_FAILED_MESSAGE = "Couldn't open Files.";

/**
 * Neither the system photo picker nor the legacy chooser would open. Android's
 * ImagePicker module keeps a native `isPickerOpen` latch that answers "canceled"
 * instantly — and silently — while it is set, so this is a dead end until the
 * app is restarted. Say that, and point at the picker that still works.
 */
export const PHOTO_LIBRARY_UNAVAILABLE_MESSAGE =
  "Couldn't open your photo library. Attach from Files, or reopen the app and try again.";

/** The line for a picker throw: a `PickerError` speaks for itself, anything else
 * falls back to the caller's generic copy. */
export function pickerErrorMessage(error: unknown, fallback: string): string {
  return error instanceof PickerError && error.message.length > 0 ? error.message : fallback;
}

/** Human file size: "512 B", "48 KB", "1.4 MB", "12 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

export function attachmentKindOf(mediaType: string): ChatAttachmentKind | "other" {
  return attachmentKindForMediaType(mediaType) ?? "other";
}

/** Short type name for a document pill's second line. */
export function fileTypeLabel(mediaType: string, filename?: string): string {
  switch (mediaType) {
    case "application/pdf":
      return "PDF";
    case "text/markdown":
      return "Markdown";
    case "text/plain":
      return "Text";
    case "text/csv":
      return "CSV";
    case "text/html":
      return "HTML";
    case "application/json":
      return "JSON";
  }
  if (mediaType.startsWith("image/")) return "Image";
  const ext = filename?.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  return ext ? ext.toUpperCase() : "File";
}

export interface FileGlyph {
  symbol: SymbolViewProps["name"];
  fallback: string;
}

/** Icon for a non-image attachment (images show their own thumbnail). */
export function fileGlyph(mediaType: string): FileGlyph {
  switch (mediaType) {
    case "application/pdf":
      return { symbol: "doc.richtext", fallback: "▤" };
    case "text/csv":
      return { symbol: "tablecells", fallback: "▦" };
    case "application/json":
      return { symbol: "curlybraces", fallback: "{}" };
    case "text/html":
      return { symbol: "chevron.left.forwardslash.chevron.right", fallback: "<>" };
    default:
      return { symbol: "doc.text", fallback: "▥" };
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * The filename to send for an image the client RE-ENCODED: the original stem
 * with the extension of the encoded format (`IMG_0001.HEIC` → `IMG_0001.jpg`),
 * so the extension-first classifier on the server agrees with the media type.
 */
export function attachmentFilename(name: string | null | undefined, mediaType: string): string {
  const ext = IMAGE_EXTENSIONS[mediaType];
  const base = (name ?? "").trim().split(/[\\/]/).pop() ?? "";
  if (!ext) return base || `file-${Date.now()}`;
  const stem = base.replace(/\.[^.]+$/, "");
  return `${stem || `photo-${Date.now()}`}${ext}`;
}

/** Local id for a staged attachment (pill key / remove target). */
export function newAttachmentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
