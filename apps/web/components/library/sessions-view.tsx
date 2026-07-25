"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, SessionTab } from "@bookmark-ai/types";
import {
  AppWindow,
  ChevronDown,
  Globe,
  Layers,
  Loader2,
  Pencil,
  Sparkles,
  SquareStack,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { aiNameSession, renameSession } from "@/lib/api";
import { restoreSessionViaExtension, type RestoreMode } from "@/lib/extension-bridge";
import { safeHref } from "@/lib/safe-href";
import { SessionsEmpty } from "./sessions-empty";
import { SessionIdentity } from "./device-badges";

export interface SessionsViewProps {
  sessions: Session[] | null;
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => void;
  /** Refetch trigger after a rename lands, so sort/search stay in sync. */
  onRenamed?: () => void;
}

/** Saved browser sessions: each expands to its tabs, with open-all / per-tab open / delete. */
export function SessionsView({ sessions, loading, error, onDelete, onRenamed }: SessionsViewProps) {
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

  // Sessions only come from the extension, so an empty list means showing what
  // that button looks like — not just naming it.
  if (!sessions || sessions.length === 0) return <SessionsEmpty />;

  return (
    <div className="space-y-4">
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} onDelete={onDelete} onRenamed={onRenamed} />
      ))}
    </div>
  );
}

export function SessionCard({
  session,
  onDelete,
  onRenamed,
  highlight,
}: {
  session: Session;
  onDelete: (id: string) => void;
  /** Refetch trigger fired once a rename (manual or AI) has committed. */
  onRenamed?: () => void;
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

  // ── Rename (inline + AI) ──────────────────────────────────────────────────
  // Local display name is the optimistic source of truth; it re-syncs whenever
  // the server-supplied prop changes (i.e. after onRenamed → refetch lands), so
  // an optimistic value and its committed value never fight.
  const [name, setName] = useState(session.name);
  useEffect(() => setName(session.name), [session.name]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);
  const [aiBusy, setAiBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(name);
    setRenameError(null);
    setEditing(true);
  };

  const commitEdit = async () => {
    if (!editing) return; // guard: blur after an Enter-commit must not re-run
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) return;
    const prev = name;
    setName(next); // optimistic
    setRenameError(null);
    try {
      const { session: updated } = await renameSession(session.id, next);
      setName(updated.name);
      onRenamed?.();
    } catch (err) {
      setName(prev); // revert
      setRenameError((err as Error).message);
    }
  };

  const cancelEdit = () => setEditing(false);

  const aiRename = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setRenameError(null);
    const prev = name;
    try {
      const { session: updated } = await aiNameSession(session.id);
      setName(updated.name);
      onRenamed?.();
    } catch (err) {
      setName(prev);
      setRenameError((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  // Restore: prefer the extension — it opens every tab as ONE new window or
  // as a titled tab group in this window. The page-side fallback (window.open
  // per tab) gets popup-blocked after the first tab, so when that happens we
  // say so instead of failing silently; tab groups have no page-side fallback.
  const openAll = async (mode: RestoreMode) => {
    const urls = session.tabs.map((t) => t.url).filter((u) => /^https?:/i.test(u));
    if (urls.length === 0) return;
    setOpenAllNote(null);
    if (await restoreSessionViaExtension(urls, { mode, name })) return;
    if (mode === "group") {
      setOpenAllNote(
        "Tab groups need the Bookmark AI extension (Chrome). Install it — or reload it if it's already installed — then try again, or use “New window”.",
      );
      return;
    }
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
        <div className="group/name min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              onBlur={cancelEdit}
              aria-label={`Rename ${name}`}
              className="w-full rounded-md border bg-background px-2 py-0.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div className="flex items-center gap-1">
              <p className="line-clamp-1 font-medium">{name}</p>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/name:opacity-100">
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label={`Rename ${name}`}
                  title="Rename"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void aiRename()}
                  disabled={aiBusy}
                  aria-label={`Rename ${name} with AI`}
                  title="Rename with AI"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  {aiBusy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="size-3.5" aria-hidden />
                  )}
                </button>
              </div>
            </div>
          )}
          {renameError ? (
            <p className="text-xs text-destructive">Rename failed. Try again.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>
                {session.tabCount} tab{session.tabCount === 1 ? "" : "s"} ·{" "}
                {formatWhen(session.savedAt)}
              </span>
              <SessionIdentity
                os={session.os}
                browser={session.browser}
                device={session.device}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden text-xs text-muted-foreground md:inline">Open all in:</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openAll("window")}
            disabled={session.tabs.length === 0}
          >
            <AppWindow className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">New window</span>
            <span className="sm:hidden">Window</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openAll("group")}
            disabled={session.tabs.length === 0}
          >
            <SquareStack className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">New tab group</span>
            <span className="sm:hidden">Group</span>
          </Button>
        </div>
        <button
          type="button"
          onClick={() => onDelete(session.id)}
          aria-label={`Delete ${name}`}
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

      {open && <TabList session={session} isMatch={isMatch} matchCount={matchCount} q={q} />}
    </div>
  );
}

type TabListRow =
  | { kind: "tab"; tab: SessionTab; index: number }
  | { kind: "fold"; start: number; tabs: SessionTab[] };

/** The expanded tab list. During a search, non-matching tabs fold away into
 * git-diff-style "N more tabs" rows that expand per run. */
function TabList({
  session,
  isMatch,
  matchCount,
  q,
}: {
  session: Session;
  isMatch: (t: SessionTab) => boolean;
  matchCount: number;
  q: string;
}) {
  // Runs of non-matching tabs collapse between the matches (like unchanged
  // lines in a diff). No matches (session matched by name) → nothing folds.
  const rows = useMemo<TabListRow[]>(() => {
    if (matchCount === 0) {
      return session.tabs.map((tab, index) => ({ kind: "tab", tab, index }));
    }
    const out: TabListRow[] = [];
    let run: SessionTab[] = [];
    session.tabs.forEach((tab, index) => {
      if (isMatch(tab)) {
        if (run.length > 0) {
          out.push({ kind: "fold", start: index - run.length, tabs: run });
          run = [];
        }
        out.push({ kind: "tab", tab, index });
      } else {
        run.push(tab);
      }
    });
    if (run.length > 0) {
      out.push({ kind: "fold", start: session.tabs.length - run.length, tabs: run });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.tabs, matchCount, q]);

  // Per-run reveal, keyed by the run's starting tab index; new query refolds.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  useEffect(() => setRevealed(new Set()), [q]);

  const tabRow = (t: SessionTab, i: number, matched: boolean) => {
    // Never render a non-http(s) URL as a live link (javascript:/data: XSS via a
    // crafted import or POST) — fall back to a non-interactive row.
    const href = safeHref(t.url);
    const inner = (
      <>
        <TabIcon favIconUrl={t.favIconUrl} />
        <span
          className={`line-clamp-1 flex-1 [overflow-wrap:anywhere] ${matched ? "font-medium" : ""}`}
        >
          {t.title || t.url}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {domainOf(t.url)}
        </span>
      </>
    );
    const cls = `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
      matched ? "bg-primary/5" : ""
    }`;
    return (
      <li key={`${t.url}-${i}`}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer noopener" className={`${cls} hover:bg-muted/50`}>
            {inner}
          </a>
        ) : (
          <span className={`${cls} text-muted-foreground`}>{inner}</span>
        )}
      </li>
    );
  };

  return (
    <ul className="divide-y border-t">
      {rows.map((row) => {
        if (row.kind === "tab") return tabRow(row.tab, row.index, matchCount > 0 && isMatch(row.tab));
        if (revealed.has(row.start)) {
          return row.tabs.map((t, j) => tabRow(t, row.start + j, false));
        }
        return (
          <li key={`fold-${row.start}`}>
            <button
              type="button"
              onClick={() => setRevealed((prev) => new Set(prev).add(row.start))}
              className="flex w-full items-center justify-center gap-2 bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <span aria-hidden>⋯</span>
              {row.tabs.length} more tab{row.tabs.length === 1 ? "" : "s"}
              <span aria-hidden>⋯</span>
            </button>
          </li>
        );
      })}
    </ul>
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
