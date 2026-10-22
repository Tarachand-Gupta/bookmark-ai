"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExtensionStoreButton } from "./extension-cta";
import { GettingStartedCard } from "./getting-started-card";
import { ImportBookmarksDialog } from "./import-bookmarks-dialog";

export interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveLink?: () => void;
  onImported?: () => void;
}

/** Reopenable tasks, with no completion prerequisite and no automatic permission request. */
export function OnboardingDialog({
  open,
  onOpenChange,
  onSaveLink,
  onImported,
}: OnboardingDialogProps) {
  const [task, setTask] = useState<"choose" | "browser" | "import">("choose");
  useEffect(() => {
    if (!open) setTask("choose");
  }, [open]);
  if (task === "import")
    return (
      <ImportBookmarksDialog open={open} onOpenChange={onOpenChange} onImported={onImported} />
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start with your links</DialogTitle>
          <DialogDescription>
            Choose what helps you now. You can return to these steps any time.
          </DialogDescription>
        </DialogHeader>
        {task === "choose" ? (
          <>
            <GettingStartedCard
              onSaveLink={() => {
                onOpenChange(false);
                onSaveLink?.();
              }}
              onImport={() => setTask("import")}
              onBrowserSetup={() => setTask("browser")}
            />
            {!onSaveLink && (
              <p className="text-sm text-muted-foreground">
                Use Add bookmark in the library to save your first link.
              </p>
            )}
            <div className="space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">Then make it useful</p>
              <p>
                Find a saved title with Search. Use folders, categories and tags to organize it. Ask
                AI to find or compare links in your library.
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <h3 className="font-medium">Save from your browser</h3>
            <p className="text-sm text-muted-foreground">
              Install the extension, open its toolbar button, and sign in to this account. Save the
              current page to check the connection.
            </p>
            <ExtensionStoreButton size="sm" />
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-medium">Existing bookmarks are a separate step</p>
              <p className="mt-1 text-muted-foreground">
                In Chrome or Firefox, choose Import existing bookmarks in the extension and allow
                bookmark access. Review the preview before importing.
              </p>
              <p className="mt-2 text-muted-foreground">
                Safari extensions cannot access your iCloud bookmark library. Export bookmarks from
                Safari on a Mac, extract the downloaded ZIP, and import its bookmarks HTML file.
              </p>
              <Button variant="outline" className="mt-3" onClick={() => setTask("import")}>
                Import a file instead
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Installing, signing in, granting access and importing are different steps. Live tab
              sharing and future bookmark mirroring are separate choices in the extension and Sync
              settings.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {task === "browser" && (
            <Button variant="ghost" onClick={() => setTask("choose")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Continue to library
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
