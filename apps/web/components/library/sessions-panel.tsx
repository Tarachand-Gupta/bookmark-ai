"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@bookmark-ai/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SessionsView } from "./sessions-view";

export interface SessionsPanelProps {
  savedSessions: Session[] | null;
  savedLoading: boolean;
  savedError: string | null;
  onDeleteSaved: (id: string) => void;
}

type SortKey = "newest" | "oldest" | "tabs" | "name";

const SORT_STORAGE_KEY = "bookmark-ai:sessions-sort";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "tabs", label: "Most tabs" },
  { value: "name", label: "Name A–Z" },
];

function isSortKey(v: string | null): v is SortKey {
  return v === "newest" || v === "oldest" || v === "tabs" || v === "name";
}

/** Server already returns newest-first (created_at DESC), so "newest" is a no-op
 * pass-through; the other keys re-sort a copy. created_at is the newest/oldest key
 * (server-stamped insert time), never the client-supplied saved_at. */
function sortSessions(sessions: Session[], key: SortKey): Session[] {
  if (key === "newest") return sessions;
  const copy = [...sessions];
  switch (key) {
    case "oldest":
      copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "tabs":
      copy.sort((a, b) => b.tabCount - a.tabCount || b.createdAt.localeCompare(a.createdAt));
      break;
    case "name":
      copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
  }
  return copy;
}

/**
 * The Saved sessions page: saved tab snapshots restored per window/tab. Live
 * open tabs are their own sidebar section (?section=live → OngoingView) now, so
 * this view no longer carries a Saved/Ongoing split.
 */
export function SessionsPanel({
  savedSessions,
  savedLoading,
  savedError,
  onDeleteSaved,
}: SessionsPanelProps) {
  // Display preference, not shareable state → localStorage (matches the library
  // view idiom). Read in an effect so SSR markup hydrates with the default.
  const [sort, setSort] = useState<SortKey>("newest");
  useEffect(() => {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (isSortKey(saved)) setSort(saved);
  }, []);
  const changeSort = (next: SortKey) => {
    setSort(next);
    localStorage.setItem(SORT_STORAGE_KEY, next);
  };

  const sorted = useMemo(
    () => (savedSessions ? sortSessions(savedSessions, sort) : savedSessions),
    [savedSessions, sort],
  );

  const hasSessions = !!savedSessions && savedSessions.length > 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Saved sessions</h2>
        {hasSessions && (
          <Select value={sort} onValueChange={(v) => changeSort(v as SortKey)}>
            <SelectTrigger
              size="sm"
              aria-label="Sort saved sessions"
              className="w-auto min-w-[9.5rem]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <SessionsView
        sessions={sorted}
        loading={savedLoading}
        error={savedError}
        onDelete={onDeleteSaved}
      />
    </div>
  );
}
