"use client";

import { useState } from "react";
import type { Session } from "@bookmark-ai/types";
import { ChevronDown, ExternalLink, Globe, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { restoreSessionViaExtension } from "@/lib/extension-bridge";

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

export function SessionCard({
  session,
  onDelete,
  highlight,
}: {
  session: Session;
  onDelete: (id: string) => void;
  /** Search query — tabs whose title/url contain it get a subtle tint. */
  highlight?: string;
}) {
  const q = highlight?.trim().toLowerCase() ?? "";
  const isMatch = (t: Session["tabs"][number]) =>
    q.length > 0 && (t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
  const matchCount = q ? session.tabs.filter(isMatch).length : 0;
  // In search results, open with the matches visible instead of folded away.
  const [open, setOpen] = useState(matchCount > 0);
  const [openAllNote, setOpenAllNote] = useState<string | null>(null);

  // Restore: prefer the extension — it opens ONE new window with every tab.
  // The page-side fallback (window.open per tab) gets popup-blocked after the
  // first tab, so when that happens we say so instead of failing silently.
  const openAll = async () => {
    const urls = session.tabs.map((t) => t.url).filter((u) => /^https?:/i.test(u));
    if (urls.length === 0) return;
    setOpenAllNote(null);
    if (await restoreSessionViaExtension(urls)) return;
    let opened = 0;
    for (const u of urls) {
      if (window.open(u, "_blank", "noopener,noreferrer")) opened++;
    }
    if (opened < urls.length) {
      setOpenAllNote(
        `Your pop-up blocker let ${opened} of ${urls.length} tabs through. Allow pop-ups for this site, or install the Bookmark AI extension to restore sessions in one window.`,
      );
    }
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => void openAll()}
          disabled={session.tabs.length === 0}
        >
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

      {openAllNote && (
        <p className="border-t bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {openAllNote}
        </p>
      )}

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
        {matchCount > 0 && (
          <span className="ml-auto font-normal">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
      </button>

      {open && (
        <ul className="divide-y border-t">
          {session.tabs.map((t, i) => {
            const matched = isMatch(t);
            return (
              <li key={`${t.url}-${i}`}>
                <a
                  href={t.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-muted/50 ${
                    matched ? "bg-primary/5" : ""
                  }`}
                >
                  <TabIcon favIconUrl={t.favIconUrl} />
                  <span
                    className={`line-clamp-1 flex-1 [overflow-wrap:anywhere] ${
                      matched ? "font-medium" : ""
                    }`}
                  >
                    {t.title || t.url}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {domainOf(t.url)}
                  </span>
                </a>
              </li>
            );
          })}
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
