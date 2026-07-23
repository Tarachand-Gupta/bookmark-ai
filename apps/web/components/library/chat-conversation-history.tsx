"use client";

import { useMemo, useState } from "react";
import { Check, MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import type { ChatConversationSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ConversationHistoryProps {
  conversations: ChatConversationSummary[];
  /** The conversation currently loaded in the chat (highlighted). */
  activeId: string | null;
  loading: boolean;
  /** "popover" = compact docked history; "panel" = the expanded-mode sidebar. */
  variant?: "popover" | "panel";
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/**
 * The conversation switcher: a search box, date-grouped rows (Today / Yesterday
 * / older dates) each with a two-step hover→confirm delete, and a full-width
 * "New conversation" action. Rendered inside a Popover when docked and as a
 * persistent left rail in the expanded two-pane mode — same component, two
 * chromes via `variant`.
 */
export function ConversationHistory({
  conversations,
  activeId,
  loading,
  variant = "popover",
  onSelect,
  onNew,
  onDelete,
}: ConversationHistoryProps) {
  const [search, setSearch] = useState("");
  // Two-step delete: first trash click arms a row; the confirm (check) actually
  // deletes. Only ONE row can be armed at a time so a stray tap can't wipe.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    return groupByDate(filtered);
  }, [conversations, search]);

  const empty = groups.length === 0;

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        variant === "panel" ? "h-full" : "max-h-[min(70dvh,28rem)]",
      )}
    >
      {/* Search */}
      <div className="shrink-0 p-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className={cn("h-8 pl-8 text-sm", search ? "pr-8" : "pr-3")}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
        {loading && conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : empty ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {search ? "No conversations match." : "No conversations yet."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <ul>
                {group.items.map((c) => (
                  <li key={c.id}>
                    <ConversationRow
                      conversation={c}
                      active={c.id === activeId}
                      armed={confirmId === c.id}
                      onSelect={() => {
                        setConfirmId(null);
                        onSelect(c.id);
                      }}
                      onArm={() => setConfirmId(c.id)}
                      onCancel={() => setConfirmId(null)}
                      onConfirm={() => {
                        setConfirmId(null);
                        onDelete(c.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* New conversation */}
      <div className="shrink-0 border-t p-2">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onNew}>
          <Plus className="size-4" aria-hidden />
          New conversation
        </Button>
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  armed,
  onSelect,
  onArm,
  onCancel,
  onConfirm,
}: {
  conversation: ChatConversationSummary;
  active: boolean;
  armed: boolean;
  onSelect: () => void;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-sm [overflow-wrap:anywhere]">
            {conversation.title || "New conversation"}
          </span>
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {relativeAge(conversation.updatedAt)}
        </span>
      </button>

      {armed ? (
        // Step 2: confirm / cancel — no accidental single-tap wipe.
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onConfirm}
            aria-label="Confirm delete conversation"
            title="Delete"
            className="flex size-6 items-center justify-center rounded text-destructive transition-colors hover:bg-destructive/10"
          >
            <Check className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel delete"
            title="Cancel"
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ) : (
        // Step 1: arm — visible on hover (and always on touch, where there's no
        // hover) but never fires the delete itself.
        <button
          type="button"
          onClick={onArm}
          aria-label="Delete conversation"
          title="Delete conversation"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-[640px]:opacity-100"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ── Date helpers ──────────────────────────────────────────────────────────────

interface DateGroup {
  label: string;
  items: ChatConversationSummary[];
}

/** Group newest-first conversations under "Today" / "Yesterday" / a dated
 * header (e.g. "Mar 3" or "Mar 3, 2024" when not this year). Assumes the input
 * is already newest-first (the API contract); preserves that order within each
 * group and emits groups in first-seen order. */
function groupByDate(conversations: ChatConversationSummary[]): DateGroup[] {
  const groups: DateGroup[] = [];
  const byLabel = new Map<string, DateGroup>();
  for (const c of conversations) {
    const label = dateLabel(c.updatedAt);
    let group = byLabel.get(label);
    if (!group) {
      group = { label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(c);
  }
  return groups;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const dayMs = 86_400_000;
  if (that === today) return "Today";
  if (that === today - dayMs) return "Yesterday";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Compact "now" / "5m" / "3h" / "2d" / "4w" relative age for the row's right edge. */
function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365)}y`;
}
