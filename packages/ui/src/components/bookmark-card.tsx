"use client";

import * as React from "react";
import type { Bookmark, Browser, DeviceType } from "@bookmark-ai/types";
import {
  Chrome,
  Compass,
  Flame,
  Globe,
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "./badge";
import { Card } from "./card";

const BROWSER_META: Record<Browser, { label: string; Icon: React.ElementType }> = {
  chrome: { label: "Chrome", Icon: Chrome },
  firefox: { label: "Firefox", Icon: Flame },
  safari: { label: "Safari", Icon: Compass },
  edge: { label: "Edge", Icon: Globe },
  arc: { label: "Arc", Icon: Globe },
  other: { label: "Web", Icon: Globe },
};

const DEVICE_META: Record<DeviceType, { label: string; Icon: React.ElementType }> = {
  desktop: { label: "Desktop", Icon: Monitor },
  laptop: { label: "Laptop", Icon: Laptop },
  mobile: { label: "Phone", Icon: Smartphone },
  tablet: { label: "Tablet", Icon: Tablet },
  other: { label: "Device", Icon: Monitor },
};

export interface BookmarkCardProps {
  bookmark: Bookmark;
  onDelete?: (id: string) => void;
  className?: string;
}

/**
 * A bookmark rendered as a rich card: OG image hero, favicon + site, title,
 * description, AI category + tags, and capture provenance (browser, device,
 * day). Pure presentational — works in Next.js, Vite, and the extension.
 */
export function BookmarkCard({ bookmark: b, onDelete, className }: BookmarkCardProps) {
  const browser = BROWSER_META[b.source.browser] ?? BROWSER_META.other;
  const device = DEVICE_META[b.source.device] ?? DEVICE_META.other;

  return (
    <Card
      className={cn(
        "group flex flex-col overflow-hidden pt-0 transition-shadow hover:shadow-md",
        className,
      )}
    >
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={b.title}
        className="block"
      >
        <CardImage bookmark={b} />
      </a>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Favicon bookmark={b} />
          <span className="truncate">{b.og.siteName ?? b.domain}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{b.domain}</span>
        </div>

        <a
          href={b.url}
          target="_blank"
          rel="noreferrer noopener"
          className="line-clamp-2 font-semibold leading-snug hover:underline"
        >
          {b.title}
        </a>

        {b.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{b.description}</p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge>{b.category}</Badge>
          {b.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="muted">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" title={`Saved from ${browser.label}`}>
            <browser.Icon className="size-3.5" aria-hidden />
            {browser.label}
          </span>
          <span className="inline-flex items-center gap-1" title={b.source.deviceName ?? device.label}>
            <device.Icon className="size-3.5" aria-hidden />
            {device.label}
          </span>
          <time dateTime={b.source.savedAt} className="ml-auto">
            {formatDay(b.source.savedAt)}
          </time>
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(b.id)}
              aria-label={`Delete ${b.title}`}
              className="rounded-md p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function CardImage({ bookmark: b }: { bookmark: Bookmark }) {
  const [failed, setFailed] = React.useState(false);
  if (!b.og.image || failed) {
    // Graceful hero fallback: muted panel with the domain's initial.
    return (
      <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-muted">
        <span className="text-4xl font-semibold text-muted-foreground/50">
          {(b.og.siteName ?? b.domain).charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts
    <img
      src={b.og.image}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-[1.91/1] w-full bg-muted object-cover"
    />
  );
}

function Favicon({ bookmark: b }: { bookmark: Bookmark }) {
  const [failed, setFailed] = React.useState(false);
  if (!b.og.favicon || failed) {
    return <Globe className="size-3.5 shrink-0" aria-hidden />;
  }
  return (
    <img
      src={b.og.favicon}
      alt=""
      onError={() => setFailed(true)}
      className="size-3.5 shrink-0 rounded-sm"
    />
  );
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
