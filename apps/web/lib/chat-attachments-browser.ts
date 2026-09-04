/**
 * Browser half of Ask AI attachments (CONTRACT §4): turn `File`s from the
 * picker / a drop / a paste into `FileUIPart`s the chat can send — classified,
 * size-checked, images downscaled to ≤1568 px and re-encoded, everything read
 * as a data URL whose media type is the CLASSIFIED one (not whatever the OS
 * guessed). Every rule and every word of copy comes from chat-attachments.ts;
 * this module only touches DOM APIs (canvas, FileReader, createImageBitmap).
 */

import type { FileUIPart } from "ai";
import {
  ATTACHMENT_COPY,
  CHAT_ATTACHMENT_RULES,
  type AttachmentKind,
  attachmentLabel,
  chooseImageEncoding,
  classifyAttachment,
  dataUrlPayloadLength,
  fitWithinEdge,
  planAttachmentBatch,
  renameForMediaType,
  sourceSizeError,
} from "./chat-attachments";

/** A rejection with user-facing copy (never a stack trace). */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

export interface PreparedAttachment {
  part: FileUIPart;
  /** Base64 payload length — what the 4 MB per-message budget counts. */
  payloadLength: number;
  /** Decoded size after processing (what the pill shows). */
  bytes: number;
  kind: AttachmentKind;
}

/** Prepare ONE file, or throw an AttachmentError with the exact copy to show. */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const classified = classifyAttachment(file.name, file.type || null);
  if (classified.kind === "rejected") throw new AttachmentError(classified.reason);
  const sizeError = sourceSizeError(classified.kind, file.size);
  if (sizeError) throw new AttachmentError(sizeError);

  const filename = attachmentLabel(file.name, classified.mediaType);
  if (classified.kind === "image") return prepareImage(file, classified.mediaType, filename);

  const url = await readAsDataUrl(file, classified.mediaType);
  return {
    part: { type: "file", mediaType: classified.mediaType, filename, url },
    payloadLength: dataUrlPayloadLength(url),
    bytes: file.size,
    kind: classified.kind,
  };
}

/**
 * Prepare a batch against what's already attached: the count cap is applied
 * BEFORE decoding (so dropping 30 photos doesn't decode 30 photos to reject
 * 25), the total-payload cap after. Errors are deduplicated, first-seen order.
 */
export async function prepareAttachments(
  files: readonly File[],
  existing: readonly FileUIPart[],
): Promise<{ files: FileUIPart[]; errors: string[] }> {
  const errors: string[] = [];
  const room = Math.max(0, CHAT_ATTACHMENT_RULES.maxFiles - existing.length);
  const toProcess = files.slice(0, room);
  if (files.length > toProcess.length) errors.push(ATTACHMENT_COPY.tooManyFiles);

  const prepared: PreparedAttachment[] = [];
  for (const file of toProcess) {
    try {
      prepared.push(await prepareAttachment(file));
    } catch (e) {
      errors.push(e instanceof AttachmentError ? e.message : ATTACHMENT_COPY.unreadable);
    }
  }

  const plan = planAttachmentBatch(
    existing.map((e) => ({ payloadLength: dataUrlPayloadLength(e.url) })),
    prepared,
  );
  for (const err of plan.errors) if (!errors.includes(err)) errors.push(err);
  return { files: plan.accepted.map((p) => p.part), errors: dedupe(errors) };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

// ── Images ───────────────────────────────────────────────────────────────────

async function prepareImage(
  file: File,
  sourceType: string,
  filename: string,
): Promise<PreparedAttachment> {
  const { maxEncodedBytes } = CHAT_ATTACHMENT_RULES.image;

  // GIF passes through untouched (re-encoding would flatten the animation) —
  // but only within the encoded cap, since we can't shrink it.
  if (sourceType === "image/gif") {
    if (file.size > maxEncodedBytes) throw new AttachmentError(ATTACHMENT_COPY.imageTooLarge);
    const url = await readAsDataUrl(file, "image/gif");
    return {
      part: { type: "file", mediaType: "image/gif", filename, url },
      payloadLength: dataUrlPayloadLength(url),
      bytes: file.size,
      kind: "image",
    };
  }

  const source = await decodeImage(file);
  try {
    const { width, height } = fitWithinEdge(source.width, source.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AttachmentError(ATTACHMENT_COPY.unreadable);
    ctx.drawImage(source.image, 0, 0, width, height);

    // JPEG sources can't carry alpha; for anything else, sample for it.
    const transparent = sourceType !== "image/jpeg" && hasTransparency(source.image);
    const encoding = chooseImageEncoding(sourceType, transparent);

    let blob = await canvasToBlob(canvas, encoding.mediaType, encoding.quality);
    // One more squeeze before giving up: a busy photo at 0.85 can land just
    // over the cap where 0.7 is still perfectly readable.
    if (blob.size > maxEncodedBytes && encoding.mediaType === "image/jpeg") {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.7);
    }
    if (blob.size > maxEncodedBytes) throw new AttachmentError(ATTACHMENT_COPY.imageTooLarge);

    const url = await readAsDataUrl(blob, encoding.mediaType);
    return {
      part: {
        type: "file",
        mediaType: encoding.mediaType,
        filename: renameForMediaType(filename, encoding.mediaType),
        url,
      },
      payloadLength: dataUrlPayloadLength(url),
      bytes: blob.size,
      kind: "image",
    };
  } finally {
    source.release();
  }
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** Decode via createImageBitmap (honours EXIF orientation) with an <img>
 * fallback for browsers/formats that refuse. */
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // fall through to the <img> path
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new AttachmentError(ATTACHMENT_COPY.unreadable));
      el.src = objectUrl;
    });
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}

/** Cheap alpha probe: draw the image onto a 48×48 canvas and look for any
 * pixel that isn't fully opaque. Sampling the full-size bitmap would allocate
 * ~10 MB for a 1568² image for a yes/no answer. */
function hasTransparency(image: CanvasImageSource): boolean {
  try {
    const probe = document.createElement("canvas");
    probe.width = 48;
    probe.height = 48;
    const ctx = probe.getContext("2d");
    if (!ctx) return false;
    ctx.clearRect(0, 0, 48, 48);
    ctx.drawImage(image, 0, 0, 48, 48);
    const { data } = ctx.getImageData(0, 0, 48, 48);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 250) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new AttachmentError(ATTACHMENT_COPY.unreadable))),
      type,
      quality,
    );
  });
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Read a blob as `data:<mediaType>;base64,…` with the media type WE decided
 * on — FileReader stamps the OS-reported type (or octet-stream), which is
 * exactly what the extension-first classification is there to override. */
function readAsDataUrl(blob: Blob, mediaType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma === -1) {
        reject(new AttachmentError(ATTACHMENT_COPY.unreadable));
        return;
      }
      resolve(`data:${mediaType};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new AttachmentError(ATTACHMENT_COPY.unreadable));
    reader.readAsDataURL(blob);
  });
}
