import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A static picture of the extension popup.
 *
 * Sessions can only be created from the extension, so a new user has to be
 * shown the button they're being told to click — there's nothing in the web app
 * to point at. Deliberately not animated, and not interactive: it's a drawing.
 *
 * Mirrors apps/extension/entrypoints/popup/App.tsx and its SaveCard, down to the
 * classes and the button labels. If those labels change, change them here too.
 *
 * `aria-hidden`: screen readers get the real prose next to it instead of a set
 * of buttons that don't do anything.
 */
export function ExtensionPopupMock({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        aria-hidden
        className="flex w-[19rem] max-w-full flex-col gap-3 rounded-xl border bg-background p-4 text-left shadow-sm select-none"
      >
        {/* header — the popup's <header> */}
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            B
          </span>
          <span className="text-sm font-semibold tracking-tight">Bookmark AI</span>
        </div>

        {/* SaveCard — the current tab, and the button that bookmarks it */}
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
              ⚑
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Designing for empty states</p>
              <p className="truncate text-xs text-muted-foreground">example.com/empty-states</p>
            </div>
          </div>
          <div className="flex h-9 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-sm">
            Save bookmark
          </div>
        </div>

        {/* The session button — the whole reason this graphic exists. */}
        <div className="flex h-9 w-full items-center justify-center rounded-lg border bg-secondary text-sm font-medium text-secondary-foreground shadow-sm ring-2 ring-primary ring-offset-2 ring-offset-background">
          Save session &amp; close (12 tabs)
        </div>
      </div>

      {/* Static pointer at the ringed button. */}
      <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <ArrowUp className="size-3.5" aria-hidden />
        This one
      </p>
    </div>
  );
}
