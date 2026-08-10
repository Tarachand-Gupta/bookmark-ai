"use client";

import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * What is about to be deleted, in the user's words: a bookmark/session title,
   * or "12 bookmarks" for a bulk delete. Shown verbatim in the heading.
   */
  label: string;
  /** Extra line above the irreversibility warning (e.g. the bulk breakdown). */
  detail?: string;
  /** Delete is in flight — the dialog stays open and both buttons lock. */
  busy?: boolean;
  /** Progress line while `busy` (e.g. "Deleted 4 of 12…"). */
  progress?: string | null;
  onConfirm: () => void;
}

/**
 * The single confirmation step in front of every delete in the library — single
 * bookmark, single session, and both bulk paths. Deletes here are immediate and
 * server-side with no undo and no trash, so the dialog says exactly that; it is
 * an AlertDialog (not a Dialog) so it traps focus and cannot be dismissed by a
 * stray click on the overlay.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  label,
  detail,
  busy,
  progress,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Never yank the dialog out from under an in-flight delete — the
        // progress line is the only feedback the user has.
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            {detail ? `${detail} ` : ""}This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {busy && progress && (
          <p className="text-sm text-muted-foreground" role="status">
            {progress}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // onClick, not the default close-on-select: bulk deletes need the
            // dialog to stay up and report progress.
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={busy}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 aria-hidden />
                Delete
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
