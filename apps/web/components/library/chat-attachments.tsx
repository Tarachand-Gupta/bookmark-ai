"use client";

import { useState, type DragEvent } from "react";
import type { FileUIPart } from "ai";
import { FileText, Paperclip, X, ZoomIn } from "lucide-react";
import {
  PromptInputButton,
  PromptInputHeader,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CHAT_ATTACHMENT_RULES,
  attachmentLabel,
  base64DecodedBytes,
  dataUrlPayloadLength,
  formatBytes,
} from "@/lib/chat-attachments";
import { cn } from "@/lib/utils";

/**
 * Ask AI attachments — the UI half (CONTRACT §4). Composer pills (thumbnail
 * or icon + name + size, remove ×), the paperclip button, the drop zone that
 * covers the whole chat while a file is dragged over it, and the transcript
 * rendering of `file` parts: image thumbnails that open a lightbox, document
 * pills. The rules (what's allowed, how big) live in lib/chat-attachments.ts;
 * this file never decides, it only shows.
 */

export function isImagePart(part: FileUIPart): boolean {
  return part.mediaType.startsWith("image/");
}

function describeSize(part: FileUIPart): string {
  const payload = dataUrlPayloadLength(part.url);
  return payload ? formatBytes(base64DecodedBytes(payload, part.url)) : "";
}

function kindLabel(mediaType: string): string {
  if (mediaType.startsWith("image/")) return "Image";
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "text/markdown") return "Markdown";
  if (mediaType === "text/csv") return "CSV";
  if (mediaType === "application/json") return "JSON";
  if (mediaType === "text/html") return "HTML";
  return "Text";
}

// ── Composer ─────────────────────────────────────────────────────────────────

/** The pills above the textarea for files waiting to be sent. */
export function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <PromptInputHeader className="gap-1.5 pb-0 pt-2.5" aria-label="Attachments">
      {attachments.files.map((file) => (
        <ComposerPill key={file.id} file={file} onRemove={() => attachments.remove(file.id)} />
      ))}
    </PromptInputHeader>
  );
}

function ComposerPill({ file, onRemove }: { file: FileUIPart; onRemove: () => void }) {
  const label = attachmentLabel(file.filename, file.mediaType);
  const image = isImagePart(file);
  const size = describeSize(file);
  return (
    <div
      className="flex h-9 max-w-[15rem] items-center gap-2 rounded-lg border bg-background pl-1 pr-1.5 text-xs shadow-xs"
      title={`${label}${size ? ` · ${size}` : ""}`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL thumbnail
        <img src={file.url} alt="" className="size-7 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileText className="size-3.5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium">{label}</span>
        <span className="block text-[10px] text-muted-foreground">
          {kindLabel(file.mediaType)}
          {size ? ` · ${size}` : ""}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        title="Remove"
        className="cursor-pointer ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}

/** The paperclip: opens the file picker. Lives in the composer footer. */
export function AttachButton({ disabled }: { disabled?: boolean }) {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      onClick={() => attachments.openFileDialog()}
      disabled={disabled}
      aria-label="Attach files"
      title={`Attach images, PDFs or text documents (up to ${CHAT_ATTACHMENT_RULES.maxFiles})`}
      className="text-muted-foreground hover:text-foreground"
    >
      <Paperclip className="size-4" aria-hidden />
    </PromptInputButton>
  );
}

function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes("Files");
}

/**
 * Wraps the chat column: dragging files over ANY part of it raises a full-panel
 * drop target, so the user doesn't have to aim at the composer. The overlay is
 * the drop target itself (it sits above the form), which is what keeps the
 * form's own drop handler from adding the same files a second time.
 */
export function ChatDropZone({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const attachments = usePromptInputAttachments();
  const [dragging, setDragging] = useState(false);

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDragging(true);
  };

  return (
    <div className={cn("relative", className)} onDragEnter={onDragEnter}>
      {children}
      {dragging && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6 backdrop-blur-[2px]"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (!next || !e.currentTarget.contains(next)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) attachments.add(files);
          }}
        >
          <div className="pointer-events-none flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-card px-8 py-6 text-center shadow-lg">
            <Paperclip className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Drop to attach</p>
            <p className="text-xs text-muted-foreground">
              Images, PDFs and text documents · up to {CHAT_ATTACHMENT_RULES.maxFiles} per message
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transcript ───────────────────────────────────────────────────────────────

/**
 * A message's `file` parts: image thumbnails (click → lightbox) and document
 * pills. Rendered inside the bubble above the text, for both roles.
 */
export function MessageFiles({ files, className }: { files: FileUIPart[]; className?: string }) {
  const [lightbox, setLightbox] = useState<FileUIPart | null>(null);
  if (files.length === 0) return null;
  const images = files.filter(isImagePart);
  const docs = files.filter((f) => !isImagePart(f));

  return (
    <div className={cn("not-prose flex flex-col gap-1.5", className)}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((file, i) => {
            const label = attachmentLabel(file.filename, file.mediaType);
            return (
              <button
                key={`${file.url.length}-${i}`}
                type="button"
                onClick={() => setLightbox(file)}
                aria-label={`Open ${label}`}
                title={label}
                className="cursor-pointer group relative size-24 cursor-zoom-in overflow-hidden rounded-lg border bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img
                  src={file.url}
                  alt={label}
                  className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                />
                <span className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <ZoomIn className="size-3" aria-hidden />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map((file, i) => {
            const label = attachmentLabel(file.filename, file.mediaType);
            const size = describeSize(file);
            return (
              <span
                key={`${label}-${i}`}
                title={`${label}${size ? ` · ${size}` : ""}`}
                className="inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-md border bg-background/70 px-2 text-xs"
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {kindLabel(file.mediaType)}
                  {size ? ` · ${size}` : ""}
                </span>
              </span>
            );
          })}
        </div>
      )}
      <ImageLightbox file={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/** Full-size view of an attached image, over a dimmed backdrop. */
function ImageLightbox({ file, onClose }: { file: FileUIPart | null; onClose: () => void }) {
  const label = file ? attachmentLabel(file.filename, file.mediaType) : "";
  const size = file ? describeSize(file) : "";
  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-auto max-w-[min(96vw,72rem)] border-0 bg-transparent p-0 text-white shadow-none sm:max-w-[min(96vw,72rem)] [&>button]:top-2 [&>button]:right-2 [&>button]:rounded-full [&>button]:bg-black/50 [&>button]:p-1.5 [&>button]:text-white [&>button]:opacity-90"
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">Attached image, full size</DialogDescription>
        {file && (
          <figure className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img
              src={file.url}
              alt={label}
              className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
            <figcaption className="text-xs text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
              {label}
              {size ? ` · ${size}` : ""}
            </figcaption>
          </figure>
        )}
      </DialogContent>
    </Dialog>
  );
}
