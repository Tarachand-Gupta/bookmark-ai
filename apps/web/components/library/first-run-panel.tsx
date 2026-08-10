"use client";

import { Check, Link2, MousePointerClick, Puzzle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtensionStoreButton, useExtensionInstalled } from "./extension-cta";

const STEPS = [
  {
    Icon: Puzzle,
    title: "Add the extension",
    body: "One install per browser. It's how pages get into your library.",
  },
  {
    Icon: MousePointerClick,
    title: "Click it on any page",
    body: "One click saves the tab. Or save every tab in the window as a session, and close them all.",
  },
  {
    Icon: Sparkles,
    title: "Find it here",
    body: "Each save is read, categorized and tagged for you — then search it by meaning, not just keywords.",
  },
];

/**
 * What a brand-new account sees instead of "No bookmarks here": nothing gets
 * saved without the extension, and until now the app never said so. Shown only
 * on a genuinely empty library — a filter that matched nothing keeps the quiet
 * one-liner (see BookmarkGrid).
 */
export function FirstRunPanel({ onAdd }: { onAdd?: () => void }) {
  // Step 1 is already done when the extension answers a detection ping, so the
  // install button becomes a checked-off note and "add one by URL" is promoted
  // from the quiet secondary action to the primary one. `null` (still checking)
  // keeps the install button — the common case is a genuinely new user.
  const installed = useExtensionInstalled();

  return (
    <section className="mx-auto max-w-3xl py-12">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">Save your first bookmark</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Bookmark AI keeps the pages you save in your browser. The extension is how they get
          here.
        </p>
      </div>

      <ol className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {STEPS.map(({ Icon, title, body }, i) => (
          <li key={title} className="flex flex-col rounded-xl border bg-card p-4 text-card-foreground">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                Step {i + 1}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-medium">{title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col items-center gap-3">
        {installed === true ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
              Extension installed — save a page from its toolbar button.
            </p>
            {onAdd && (
              <Button onClick={onAdd}>
                <Link2 aria-hidden />
                Or add one by URL
              </Button>
            )}
          </>
        ) : (
          <>
            <ExtensionStoreButton />
            {onAdd && (
              <Button variant="ghost" size="sm" onClick={onAdd} className="text-muted-foreground">
                <Link2 aria-hidden />
                Or add one by URL
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
