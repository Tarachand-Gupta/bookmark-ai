"use client";

import type { Session } from "@bookmark-ai/types";
import { SessionsView } from "./sessions-view";

export interface SessionsPanelProps {
  savedSessions: Session[] | null;
  savedLoading: boolean;
  savedError: string | null;
  onDeleteSaved: (id: string) => void;
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
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Saved sessions</h2>
      <SessionsView
        sessions={savedSessions}
        loading={savedLoading}
        error={savedError}
        onDelete={onDeleteSaved}
      />
    </div>
  );
}
