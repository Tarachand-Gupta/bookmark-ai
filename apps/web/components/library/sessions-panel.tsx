"use client";

import { useState } from "react";
import type { Session } from "@bookmark-ai/types";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SessionsView } from "./sessions-view";
import { OngoingView } from "./ongoing-view";
import type { SectionId } from "./settings-dialog";

type Segment = "saved" | "ongoing";

export interface SessionsPanelProps {
  savedSessions: Session[] | null;
  savedLoading: boolean;
  savedError: string | null;
  onDeleteSaved: (id: string) => void;
  /** Refetch the saved list after an Ongoing window is promoted to a session. */
  onSavedSession: () => void;
  onOpenSettings?: (section?: SectionId) => void;
}

/**
 * The Sessions page: a Saved / Ongoing split. Saved (existing saved snapshots)
 * is the default; Ongoing reads live open tabs from every device. Mounting the
 * Ongoing view only while its segment is active is what pauses polling on Saved.
 */
export function SessionsPanel({
  savedSessions,
  savedLoading,
  savedError,
  onDeleteSaved,
  onSavedSession,
  onOpenSettings,
}: SessionsPanelProps) {
  const [segment, setSegment] = useState<Segment>("saved");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Sessions</h2>
        <SegmentedControl
          ariaLabel="Sessions view"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "saved", label: "Saved", count: savedSessions?.length ?? null },
            { value: "ongoing", label: "Ongoing" },
          ]}
        />
      </div>

      {segment === "saved" ? (
        <SessionsView
          sessions={savedSessions}
          loading={savedLoading}
          error={savedError}
          onDelete={onDeleteSaved}
        />
      ) : (
        <OngoingView onSaved={onSavedSession} onOpenSettings={onOpenSettings} />
      )}
    </div>
  );
}
