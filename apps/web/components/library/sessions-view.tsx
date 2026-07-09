"use client";

import { useState } from "react";
import type { Session } from "@bookmark-ai/types";
import { ChevronDown, ExternalLink, Globe, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export interface SessionsViewProps {
  sessions: Session[] | null;
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => void;
}

/** Saved browser sessions: each expands to its tabs, with open-all / per-tab open / delete. */
export function SessionsView({ sessions, loading, error, onDelete }: SessionsViewProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-medium">Could not load sessions</p>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (loading && !sessions) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Layers className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="font-medium">No saved sessions yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          In the browser extension, use <strong>Save session &amp; close</strong> to snapshot all
          your open tabs here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} onDelete={onDelete} />
      ))}
    </div>
  );
}

function SessionCard({ session, onDelete }: { session: Session; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);

  // Best-effort "restore": open each tab. A true multi-tab new window is only
  // possible from the extension (chrome.windows.create) — browsers block it here.
  const openAll = () => {
    for (const t of session.tabs) window.open(t.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Layers className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 font-medium">{session.name}</p>
          <p className="text-xs text-muted-foreground">
            {session.tabCount} tab{session.tabCount === 1 ? "" : "s"} ·{" "}
            {formatWhen(session.savedAt)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={openAll} disabled={session.tabs.length === 0}>
          <ExternalLink className="size-3.5" aria-hidden />
          Open all
        </Button>
        <button
          type="button"
          onClick={() => onDelete(session.id)}
          aria-label={`Delete ${session.name}`}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 border-t px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
        {open ? "Hide tabs" : `Show ${session.tabCount} tab${session.tabCount === 1 ? "" : "s"}`}
      </button>

      {open && (
        <ul className="divide-y border-t">
          {session.tabs.map((t, i) => (
            <li key={`${t.url}-${i}`}>
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-muted/50"
              >
                <TabIcon favIconUrl={t.favIconUrl} />
                <span className="line-clamp-1 flex-1 [overflow-wrap:anywhere]">
                  {t.title || t.url}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {domainOf(t.url)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TabIcon({ favIconUrl }: { favIconUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!favIconUrl || failed) {
    return <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return (
    <img
      src={favIconUrl}
      alt=""
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm"
    />
  );
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
