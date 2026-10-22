"use client";

import { BookmarkPlus, Download, Puzzle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GettingStartedCardProps {
  onSaveLink: () => void;
  onImport: () => void;
  onBrowserSetup: () => void;
  onDismiss?: () => void;
}
/** Optional first-session tasks; completion never blocks the library. */
export function GettingStartedCard({
  onSaveLink,
  onImport,
  onBrowserSetup,
  onDismiss,
}: GettingStartedCardProps) {
  return (
    <section
      aria-labelledby="getting-started-title"
      className="relative rounded-xl border bg-card p-5"
    >
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute end-2 top-2"
          onClick={onDismiss}
          aria-label="Dismiss getting started"
        >
          <X className="size-4" />
        </Button>
      )}
      <h2 id="getting-started-title" className="pe-8 text-lg font-semibold">
        Make this library yours
      </h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        Bring a few links, find them again, and organize them your way. Start with any step.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSaveLink}>
          <BookmarkPlus className="size-4" />
          Save a link
        </Button>
        <Button variant="outline" onClick={onImport}>
          <Download className="size-4" />
          Import existing links
        </Button>
        <Button variant="ghost" onClick={onBrowserSetup}>
          <Puzzle className="size-4" />
          Set up browser saving
        </Button>
      </div>
    </section>
  );
}
