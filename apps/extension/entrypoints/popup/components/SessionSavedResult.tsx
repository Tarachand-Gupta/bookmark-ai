import type { Session } from "@bookmark-ai/types";

/** Confirmation for the "keep open" session save. The closing path needs no
 * confirmation — the window vanishing and the web app opening IS the feedback —
 * but here nothing visibly changes, so say so before the popup auto-closes. */
export function SessionSavedResult({ session }: { session: Session }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
          ✓
        </span>
        <p className="truncate text-sm font-medium">
          Saved {session.tabCount} tab{session.tabCount === 1 ? "" : "s"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Session saved — your tabs are still open.
      </p>
    </div>
  );
}
