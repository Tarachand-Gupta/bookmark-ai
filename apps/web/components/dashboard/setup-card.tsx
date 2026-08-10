"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Radio, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SETUP_DISMISSED_KEY } from "@/lib/dashboard";
import {
  ExtensionStoreButton,
  useExtensionInstalled,
} from "@/components/library/extension-cta";
import type { SectionId } from "@/components/library/settings-dialog";

/**
 * Setup / quick actions (doc §3.8): renders ONLY unfinished steps, and only while
 * any remain. Once the extension is installed, something is saved and live
 * sessions are on, this card is gone forever — no permanent "getting started"
 * furniture on a landing page someone uses every day.
 *
 * Dismissible too (localStorage), because a user who deliberately doesn't want
 * live sessions shouldn't be nagged about it on every visit.
 */
export function SetupCard({
  totalBookmarks,
  liveEnabled,
  onAdd,
  onOpenSettings,
  className,
}: {
  totalBookmarks: number;
  /** From the live hook: true/false when known, null when live is unreachable or
   * still loading — unknown never produces a step (we don't guess, and we never
   * surface live failures here). */
  liveEnabled: boolean | null;
  onAdd: () => void;
  onOpenSettings: (section?: SectionId) => void;
  className?: string;
}) {
  const installed = useExtensionInstalled();
  // Read in an effect, not during render: no localStorage on the server.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(SETUP_DISMISSED_KEY) === "1");
    } catch {
      // Storage disabled — treat as not dismissed.
    }
  }, []);

  const steps: { key: string; label: string; hint: string; action: React.ReactNode }[] = [];
  // `null` (still detecting) shows no step — the flash of an install prompt at a
  // user who has it installed is exactly what the detection memo exists to avoid.
  if (installed === false) {
    steps.push({
      key: "extension",
      label: "Install the browser extension",
      hint: "It's how pages — and whole windows of tabs — get in here.",
      action: <ExtensionStoreButton size="sm" variant="outline" />,
    });
  }
  if (totalBookmarks === 0) {
    steps.push({
      key: "first-save",
      label: "Save your first bookmark",
      hint: "Use the extension, or paste a URL to try it now.",
      action: (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Link2 aria-hidden />
          Add a URL
        </Button>
      ),
    });
  }
  if (liveEnabled === false) {
    steps.push({
      key: "live",
      label: "Turn on live sessions",
      hint: "See the tabs open on your other devices, and pick them up here.",
      action: (
        <Button size="sm" variant="outline" onClick={() => onOpenSettings("devices")}>
          <Radio aria-hidden />
          Enable
        </Button>
      ),
    });
  }

  if (dismissed || steps.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-xl border border-dashed bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Rocket className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Finish setting up</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {steps.length} step{steps.length === 1 ? "" : "s"} left — this card disappears once
            they&apos;re done.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(SETUP_DISMISSED_KEY, "1");
            } catch {
              // Best effort — it'll reappear next visit, which is acceptable.
            }
          }}
          aria-label="Dismiss setup card"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* The grid used to be hardcoded to sm:grid-cols-2 lg:grid-cols-3 regardless
          of how many steps remained — with one step left that left ~2/3 of the
          card's full-width body empty, and ~1/3 empty with two. Column count now
          tracks steps.length so the tiles fill the card's width no matter which
          steps are outstanding. A single remaining tile also switches to a row
          layout at sm+ (label/hint left, action right) instead of the stacked
          layout — a lone full-width tile stacked top-to-bottom just left the
          same dead space underneath the text instead of beside it. */}
      <ul
        className={cn(
          "mt-3 grid gap-2",
          steps.length >= 2 && "sm:grid-cols-2",
          steps.length >= 3 && "lg:grid-cols-3",
        )}
      >
        {steps.map((step, i) => (
          <li
            key={step.key}
            className={cn(
              "flex flex-col gap-2 rounded-lg border bg-background/50 p-3",
              steps.length === 1 && "sm:flex-row sm:items-center sm:justify-between sm:gap-4",
              // Three steps in a 2-column grid (sm/md) leaves the third tile
              // alone with an empty cell beside it — the same hole, one row
              // lower. Let it span the row there; at lg the grid is 3-up and it
              // goes back to one column.
              steps.length === 3 && i === 2 && "sm:col-span-2 lg:col-span-1",
            )}
          >
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"
              >
                <Check className="size-2.5 opacity-0" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{step.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.hint}</p>
              </div>
            </div>
            <div className={cn("mt-auto", steps.length === 1 && "sm:mt-0 sm:shrink-0")}>
              {step.action}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
