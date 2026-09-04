import type { UIMessage } from "ai";
import {
  ATTACHMENT_REJECTED_MESSAGE,
  attachmentByteLimit,
  attachmentKindForMediaType,
  CHAT_ATTACHMENT_RULES,
  classifyAttachment,
  type ChatAttachmentKind,
  type ClassifiedAttachment,
} from "@bookmark-ai/types";

/**
 * Server-side half of the attachment contract (packages/types `CHAT_ATTACHMENT_RULES`
 * is the single source of truth every client enforces first):
 *
 *  - `validateChatAttachments` re-enforces the allowlist and byte limits on the
 *    `file` UI parts of the incoming user message(s) BEFORE any model call —
 *    415 for a disallowed type, 413 for anything over its limit, 400 for a count
 *    or URL-shape problem — so a client bug (or a hostile client) can't push an
 *    arbitrary payload at the provider.
 *  - `normalizeAttachmentsForModel` rewrites the messages the MODEL sees:
 *    document-kind parts (text/*, JSON) are decoded and appended to the user's
 *    text as `<attachment name type>…</attachment>` blocks (model-agnostic —
 *    OpenAI/Anthropic don't accept text file parts), image + PDF parts pass
 *    through as file parts with their normalized media type. The STORED UI
 *    message keeps the original parts so transcripts render pills/thumbnails.
 *
 * Only inline `data:` URLs are accepted. A hosted URL would make the AI SDK (or
 * the provider) fetch it server-side — an SSRF channel — so it is refused.
 */

export type AttachmentValidation =
  | { ok: true }
  | { ok: false; status: 400 | 413 | 415; body: Record<string, unknown> };

interface FilePartLike {
  type: "file";
  mediaType?: string;
  filename?: string;
  url?: string;
}

function isFilePart(part: unknown): part is FilePartLike {
  return !!part && typeof part === "object" && (part as { type?: unknown }).type === "file";
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return !!part && typeof part === "object" && (part as { type?: unknown }).type === "text";
}

/** Parse a `data:` URL into its base64 payload; null for anything else
 * (including non-base64 data URLs, which no client emits). */
export function dataUrlPayload(url: string): { mediaType: string | null; base64: string } | null {
  if (typeof url !== "string" || !url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  // `data:<mediatype>[;param=value…][;base64],<payload>`
  const [mediaType = "", ...params] = url.slice("data:".length, comma).split(";");
  if (!params.some((p) => p.trim().toLowerCase() === "base64")) return null;
  return { mediaType: mediaType ? mediaType.trim().toLowerCase() : null, base64: url.slice(comma + 1) };
}

/**
 * Binary signature → media type, for the formats that have one. Text documents
 * have no signature and are never sniffed. Only the first bytes of the base64
 * payload are decoded.
 */
export function sniffMediaType(base64: string): string | null {
  let head: Buffer;
  try {
    head = Buffer.from(base64.slice(0, 24), "base64");
  } catch {
    return null;
  }
  if (head.length < 4) return null;
  const hex = head.subarray(0, 4).toString("hex");
  if (hex === "89504e47") return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex === "47494638") return "image/gif";
  if (hex === "25504446") return "application/pdf";
  if (hex === "52494646" && head.length >= 12 && head.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/**
 * The media type the MODEL should get for a file part. What the bytes ARE wins:
 * the binary signature first (a pasted JPEG saved as "Pasted image.png" —
 * whatever the client wrote in the filename or data URL — reaches the model as
 * image/jpeg), then the data URL's own type when it is an allowed BINARY type
 * (image/pdf: the client encoded it and knows), then the filename's extension
 * (for text documents the extension is the precise signal — `.md` beats an
 * OS-reported `text/plain` data URL), then the data URL / reported MIME for a
 * nameless clipboard blob. A known-disallowed EXTENSION still rejects the file
 * (`app.ts` sent as text/plain is refused either way), so the code/media ban
 * holds.
 */
export function resolveAttachment(part: FilePartLike): ClassifiedAttachment {
  const filename = typeof part.filename === "string" ? part.filename : "";
  const byName = classifyAttachment(filename, part.mediaType ?? null);
  const payload = dataUrlPayload(typeof part.url === "string" ? part.url : "");
  const sniffed = payload ? sniffMediaType(payload.base64) : null;
  const declared = payload?.mediaType ?? null;
  const fromBytes = sniffed && attachmentKindForMediaType(sniffed) ? sniffed : null;
  const declaredKind = declared ? attachmentKindForMediaType(declared) : null;
  const fromDataUrl = declared && declaredKind ? declared : null;
  const hasExtension = /\.[^./\\]+$/.test(filename.trim().split(/[\\/]/).pop() ?? "");

  if (byName.kind === "rejected" && hasExtension) {
    return { kind: "rejected", reason: ATTACHMENT_REJECTED_MESSAGE };
  }
  const mediaType =
    fromBytes ??
    (fromDataUrl && declaredKind !== "document" ? fromDataUrl : null) ??
    (byName.kind === "rejected" ? null : byName.mediaType) ??
    fromDataUrl;
  const kind = mediaType ? attachmentKindForMediaType(mediaType) : null;
  return mediaType && kind ? { kind, mediaType } : { kind: "rejected", reason: ATTACHMENT_REJECTED_MESSAGE };
}

/** Decoded byte length of a base64 string, without decoding it. */
export function decodedByteLength(base64: string): number {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export function validateChatAttachments(messages: UIMessage[]): AttachmentValidation {
  const rules = CHAT_ATTACHMENT_RULES;
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.parts)) continue;
    const files = (message.parts as unknown[]).filter(isFilePart);
    if (files.length === 0) continue;
    if (files.length > rules.maxFiles) {
      return {
        ok: false,
        status: 400,
        body: { error: "too-many-attachments", maxFiles: rules.maxFiles },
      };
    }
    let total = 0;
    for (const file of files) {
      const filename = typeof file.filename === "string" ? file.filename : "";
      const reported = typeof file.mediaType === "string" ? file.mediaType : "";
      const classified = resolveAttachment(file);
      if (classified.kind === "rejected") {
        return {
          ok: false,
          status: 415,
          body: { error: "attachment-type-not-allowed", filename, mediaType: reported },
        };
      }
      const payload = dataUrlPayload(typeof file.url === "string" ? file.url : "");
      if (!payload) {
        return {
          ok: false,
          status: 400,
          body: { error: "attachment-url-not-allowed", filename },
        };
      }
      const bytes = decodedByteLength(payload.base64);
      const limit = attachmentByteLimit(classified.kind);
      if (bytes > limit) {
        return {
          ok: false,
          status: 413,
          body: { error: "attachments-too-large", limitBytes: limit, filename },
        };
      }
      total += bytes;
    }
    if (total > rules.maxTotalEncodedBytes) {
      return {
        ok: false,
        status: 413,
        body: { error: "attachments-too-large", limitBytes: rules.maxTotalEncodedBytes },
      };
    }
  }
  return { ok: true };
}

function decodeText(base64: string): string {
  // Strip a UTF-8 BOM and normalize line endings so the model sees clean text.
  return Buffer.from(base64, "base64").toString("utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

/** The `<attachment>` block a document becomes in the user's text. */
export function attachmentBlock(filename: string, mediaType: string, content: string): string {
  return `<attachment name="${escapeAttr(filename || "attachment")}" type="${mediaType}">\n${content}\n</attachment>`;
}

/**
 * Messages as the MODEL should see them (see the module comment). Non-user
 * messages and user messages without file parts are returned as-is; the input
 * is never mutated.
 */
export function normalizeAttachmentsForModel(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.parts)) return message;
    const parts = message.parts as unknown[];
    if (!parts.some(isFilePart)) return message;

    const kept: unknown[] = [];
    const blocks: string[] = [];
    for (const part of parts) {
      if (!isFilePart(part)) {
        kept.push(part);
        continue;
      }
      const filename = typeof part.filename === "string" ? part.filename : "";
      const classified = resolveAttachment(part);
      if (classified.kind === "rejected") continue; // validation already refused; drop defensively
      const kind: ChatAttachmentKind = classified.kind;
      if (kind === "document") {
        const payload = dataUrlPayload(part.url ?? "");
        blocks.push(attachmentBlock(filename, classified.mediaType, payload ? decodeText(payload.base64) : ""));
      } else {
        kept.push({ ...part, mediaType: classified.mediaType });
      }
    }

    if (blocks.length > 0) {
      const suffix = blocks.join("\n\n");
      let lastText = -1;
      for (let i = kept.length - 1; i >= 0; i--) {
        if (isTextPart(kept[i])) {
          lastText = i;
          break;
        }
      }
      if (lastText >= 0) {
        const text = kept[lastText] as { type: "text"; text: string };
        kept[lastText] = { ...text, text: `${text.text}\n\n${suffix}` };
      } else {
        kept.push({ type: "text", text: suffix });
      }
    }
    return { ...message, parts: kept as UIMessage["parts"] };
  });
}
