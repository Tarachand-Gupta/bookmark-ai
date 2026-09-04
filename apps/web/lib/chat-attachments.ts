import {
  ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE,
  ATTACHMENT_REJECTED_MESSAGE,
  ATTACHMENTS_TOO_LARGE_MESSAGE,
  ATTACHMENTS_TOO_MANY_MESSAGE,
  CHAT_ATTACHMENT_RULES,
  type ChatAttachmentKind,
} from "@bookmark-ai/types";

/**
 * Ask AI attachments — the client-side half of CONTRACT §4.
 *
 * The rules table, the classifier and the shared rejection copy come from
 * `@bookmark-ai/types` (packages/types/src/chat.ts) — the same module the
 * server enforces with, so what the composer refuses is exactly what the API
 * would 413/415. This file adds the client-only decisions around them: image
 * downscale math, base64 budgeting, per-message batch caps, labels.
 *
 * Pure and dependency-free (unit-tested in chat-attachments.test.ts). The
 * browser-only pipeline — decode, downscale, re-encode, read as data URL —
 * lives in chat-attachments-browser.ts and calls into this module for every
 * decision.
 */

export {
  CHAT_ATTACHMENT_RULES,
  classifyAttachment,
  type ClassifiedAttachment,
} from "@bookmark-ai/types";

export type AttachmentKind = ChatAttachmentKind;

/** The user-facing copy — the shared strings from the contract plus the
 * client-only cases (source-size caps, unreadable files). */
export const ATTACHMENT_COPY = {
  disallowed: ATTACHMENT_REJECTED_MESSAGE,
  imageTooLarge: ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE,
  totalTooLarge: ATTACHMENTS_TOO_LARGE_MESSAGE,
  tooManyFiles: ATTACHMENTS_TOO_MANY_MESSAGE,
  imageSourceTooLarge: "Images over 10 MB can't be attached.",
  documentTooLarge: "Text documents over 1 MB can't be attached.",
  pdfTooLarge: "PDFs over 3 MB can't be attached.",
  unreadable: "That file couldn't be read.",
} as const;

/** ".ext" lower-cased, or "" when the name has no extension (a dotfile such as
 * `.bashrc` counts as extension-less HERE — this helper only renames files
 * after re-encoding; classification uses the shared `classifyAttachment`). */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot).toLowerCase();
}

/** The `accept` attribute for the hidden file input: every allowed extension
 * plus every allowed MIME, so both the picker filter and OS-level matching work. */
export function attachmentAcceptAttribute(): string {
  const { extensionToMediaType, image, document, pdf } = CHAT_ATTACHMENT_RULES;
  const parts = new Set<string>([
    ...Object.keys(extensionToMediaType),
    ...image.mediaTypes,
    ...document.mediaTypes,
    ...pdf.mediaTypes,
  ]);
  return [...parts].join(",");
}

/** Per-kind cap on what may be READ from disk (before any processing). Null
 * when the size is fine, else the exact copy to show. */
export function sourceSizeError(kind: AttachmentKind, bytes: number): string | null {
  const { image, document, pdf } = CHAT_ATTACHMENT_RULES;
  if (kind === "image") return bytes > image.maxSourceBytes ? ATTACHMENT_COPY.imageSourceTooLarge : null;
  if (kind === "document") return bytes > document.maxBytes ? ATTACHMENT_COPY.documentTooLarge : null;
  return bytes > pdf.maxBytes ? ATTACHMENT_COPY.pdfTooLarge : null;
}

/**
 * Scale (w, h) down so the longest edge is ≤ maxEdge, preserving aspect ratio
 * and never upscaling. Dimensions are rounded to whole pixels and floored at 1.
 */
export function fitWithinEdge(
  width: number,
  height: number,
  maxEdge: number = CHAT_ATTACHMENT_RULES.image.maxEdgePx,
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 1, height: 1, scale: 1 };
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height), scale: 1 };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * The base64 payload length of a data: URL — the bytes that actually travel in
 * the request body, which is what the 4 MB per-message cap counts. Non-data
 * URLs (blob:, http:) contribute 0: they're not in the body.
 */
export function dataUrlPayloadLength(url: string): number {
  if (!url.startsWith("data:")) return 0;
  const comma = url.indexOf(",");
  return comma === -1 ? 0 : url.length - comma - 1;
}

/** Decoded size of a base64 payload (what the file weighs once the server
 * decodes it) — for the pill's size label. */
export function base64DecodedBytes(payloadLength: number, url?: string): number {
  if (payloadLength <= 0) return 0;
  let padding = 0;
  if (url) {
    if (url.endsWith("==")) padding = 2;
    else if (url.endsWith("=")) padding = 1;
  }
  return Math.max(0, Math.floor((payloadLength * 3) / 4) - padding);
}

/** Base64 length a binary of `bytes` will occupy (4 chars per 3 bytes, padded). */
export function base64LengthFor(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / 3) * 4;
}

/** "340 KB" / "1.2 MB" — one decimal above 1 MB, none below. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

export interface BatchCandidate {
  /** Base64 payload length this attachment will add to the message body. */
  payloadLength: number;
}

export interface BatchPlan<T extends BatchCandidate> {
  accepted: T[];
  /** Deduplicated, in first-seen order — shown as inline error text. */
  errors: string[];
}

/**
 * Apply the per-message caps (count, total payload) to a batch of already
 * prepared candidates, given what's already attached. Order-preserving:
 * earlier files win when the batch overflows, and each overflow reason is
 * reported once.
 */
export function planAttachmentBatch<T extends BatchCandidate>(
  existing: readonly BatchCandidate[],
  incoming: readonly T[],
  rules: { maxFiles: number; maxTotalEncodedBytes: number } = CHAT_ATTACHMENT_RULES,
): BatchPlan<T> {
  const accepted: T[] = [];
  const errors: string[] = [];
  let count = existing.length;
  let total = existing.reduce((sum, e) => sum + e.payloadLength, 0);
  for (const candidate of incoming) {
    if (count >= rules.maxFiles) {
      if (!errors.includes(ATTACHMENT_COPY.tooManyFiles)) errors.push(ATTACHMENT_COPY.tooManyFiles);
      continue;
    }
    if (total + candidate.payloadLength > rules.maxTotalEncodedBytes) {
      if (!errors.includes(ATTACHMENT_COPY.totalTooLarge)) errors.push(ATTACHMENT_COPY.totalTooLarge);
      continue;
    }
    accepted.push(candidate);
    count += 1;
    total += candidate.payloadLength;
  }
  return { accepted, errors };
}

/** Which output format a decoded image should be re-encoded to. GIFs pass
 * through untouched (animation would be lost); PNG only when the source has
 * transparency (a JPEG would paint it black); everything else → JPEG 0.85. */
export function chooseImageEncoding(
  sourceMediaType: string,
  hasTransparency: boolean,
): { mediaType: "image/jpeg" | "image/png" | "image/gif"; quality?: number; passthrough: boolean } {
  if (sourceMediaType === "image/gif") return { mediaType: "image/gif", passthrough: true };
  if (hasTransparency) return { mediaType: "image/png", passthrough: false };
  return { mediaType: "image/jpeg", quality: 0.85, passthrough: false };
}

/**
 * The server re-checks every attachment before the model call and answers with
 * a typed body (CONTRACT §4 + BACKEND additions):
 *   400 { error: "too-many-attachments", maxFiles }
 *   400 { error: "attachment-url-not-allowed", filename }
 *   413 { error: "attachments-too-large", limitBytes, filename? }
 *   415 { error: "attachment-type-not-allowed", filename, mediaType }
 * Turn one into the sentence the composer shows, or null when the response is
 * not an attachment rejection at all (so the generic error path handles it).
 */
export function describeAttachmentServerError(status: number, body: unknown): string | null {
  // Some builds return 413 without a typed body when the whole request is over
  // the platform cap; treat any 413 as the total-size rejection.
  if (body === null || typeof body !== "object") {
    return status === 413 ? ATTACHMENT_COPY.totalTooLarge : null;
  }
  const rec = body as Record<string, unknown>;
  const error = typeof rec.error === "string" ? rec.error : "";
  const filename = typeof rec.filename === "string" && rec.filename.trim() ? rec.filename.trim() : null;
  switch (error) {
    case "too-many-attachments": {
      const max = typeof rec.maxFiles === "number" ? rec.maxFiles : CHAT_ATTACHMENT_RULES.maxFiles;
      return `Up to ${max} files per message.`;
    }
    case "attachment-url-not-allowed":
      return `${filename ? `“${filename}”` : "An attachment"} couldn't be sent — only files from your device can be attached, not links.`;
    case "attachments-too-large": {
      const limit = typeof rec.limitBytes === "number" ? rec.limitBytes : null;
      if (filename) {
        return `“${filename}” is too large${limit ? ` (limit ${formatBytes(limit)})` : ""}.`;
      }
      return ATTACHMENT_COPY.totalTooLarge;
    }
    case "attachment-type-not-allowed":
      return `${filename ? `“${filename}” ` : ""}${filename ? "isn't an allowed type. " : ""}${ATTACHMENT_COPY.disallowed}`;
    default:
      return status === 413 ? ATTACHMENT_COPY.totalTooLarge : null;
  }
}

/** Human label for a pill/thumbnail: the filename, or a kind-based fallback
 * for clipboard pastes that arrive nameless. */
export function attachmentLabel(filename: string | undefined, mediaType: string): string {
  if (filename && filename.trim()) return filename.trim();
  if (mediaType.startsWith("image/")) return "Pasted image";
  if (mediaType === "application/pdf") return "Document.pdf";
  return "Pasted text";
}

/** Swap the extension on a name to match the format it was re-encoded to
 * (`photo.png` downscaled to JPEG → `photo.jpg`), so the label doesn't lie. */
export function renameForMediaType(filename: string, mediaType: string): string {
  const ext = mediaType === "image/jpeg" ? ".jpg" : mediaType === "image/png" ? ".png" : null;
  if (!ext) return filename;
  const current = extensionOf(filename);
  if (current === ext || (ext === ".jpg" && current === ".jpeg")) return filename;
  const stem = current ? filename.slice(0, -current.length) : filename;
  return `${stem}${ext}`;
}
