"use client";

import { ArrowRight, ArrowUpRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  downloadAnchor,
  resolveDownload,
  type PlatformEntry,
} from "@/lib/platforms";
import { btnOutline, btnPrimary, mono } from "./primitives";
import { useReleases } from "./releases-provider";

const DOWNLOAD_LABELS: Partial<Record<PlatformEntry["id"], string>> = {
  macos: "Download for Mac",
  android: "Download APK",
};

/**
 * A platform's primary control, with the release record folded in:
 * - download → the published record's URL (Settings → Releases) when there is
 *   one, else the static tag asset; the version it hands over sits underneath.
 * - open → a plain link (web app; the PWA path on iOS).
 * - none → on the homepage, "Install options" into the /download card; on the
 *   download page itself (`onDownloadPage`) the sideload zip, if any, takes
 *   the outline slot and no primary is drawn.
 */
export function PlatformActionButton({
  entry,
  onDownloadPage = false,
  compact = false,
  reserveCaption = false,
  className,
}: {
  entry: PlatformEntry;
  onDownloadPage?: boolean;
  compact?: boolean;
  /**
   * Reserve two caption lines under the button so buttons in a card grid sit
   * on one baseline whether their caption wraps or not.
   */
  reserveCaption?: boolean;
  className?: string;
}) {
  const releases = useReleases();
  const { action } = entry;
  const size = compact ? "h-10 px-5" : "";
  const caption = cn(mono, "text-[11px] leading-4 text-muted-foreground", reserveCaption && "min-h-8");

  if (action.type === "download") {
    const resolved = resolveDownload(action, releases)!;
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <a
          href={resolved.url}
          download
          rel="noreferrer noopener"
          className={cn(btnPrimary, size)}
          aria-label={`${DOWNLOAD_LABELS[entry.id] ?? "Download"} (version ${resolved.version ?? "unknown"})`}
        >
          <Download className="size-4" aria-hidden />
          {DOWNLOAD_LABELS[entry.id] ?? "Download"}
        </a>
        <p className={caption}>
          {resolved.version ? `v${resolved.version}` : "latest"}
          {entry.requires && (
            <>
              <span aria-hidden className="mx-1.5 text-border">
                /
              </span>
              {entry.requires}
            </>
          )}
        </p>
      </div>
    );
  }

  if (action.type === "open") {
    const external = action.url.startsWith("https://");
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <a
          href={action.url}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer noopener" : undefined}
          className={cn(entry.status === "available" ? btnPrimary : btnOutline, size)}
        >
          {action.label}
          {external ? (
            <ArrowUpRight className="size-4" aria-hidden />
          ) : (
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          )}
        </a>
        {entry.requires && <p className={caption}>{entry.requires}</p>}
      </div>
    );
  }

  if (onDownloadPage) {
    if (!entry.sideload) return null;
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <a
          href={entry.sideload.url}
          download
          rel="noreferrer noopener"
          className={cn(btnOutline, size)}
        >
          <Download className="size-4" aria-hidden />
          Download zip to sideload
        </a>
        {/* The filename gets its own line on narrow screens and may break
            anywhere — a mid-filename wrap is fine when it is deliberate. */}
        <p className={caption}>
          v{entry.sideload.version}
          <span aria-hidden className="mx-1.5 hidden text-border sm:inline">
            /
          </span>
          <span className="block break-all sm:inline">{entry.sideload.fileName}</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <a href={downloadAnchor(entry.id)} className={cn(btnOutline, size)}>
        Install options
        <ArrowRight className="size-4" aria-hidden />
      </a>
      {entry.requires && <p className={caption}>{entry.requires}</p>}
    </div>
  );
}
