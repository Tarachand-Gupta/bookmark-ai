"use client";

import { Sparkles, X } from "lucide-react";
import type { AiUsage } from "@bookmark-ai/types";
import { cn } from "@/lib/utils";
import { daysUntilReset, formatCredits, toCreditsView } from "@/lib/ai-credits";

/**
 * The ONE free-credits meter, shared by every surface that markets the free tier:
 * the AI setup card's hero, the chat's first-open greeting, and Settings → AI.
 * Three copies of this drifted apart in an afternoon last time — so the numbers,
 * the wording and the "resets Monday" truth live here and nowhere else.
 *
 * Units: `AiUsage` is TOKENS on the wire; `toCreditsView` normalizes to credits at
 * 1,000 tokens each (see lib/ai-credits.ts). Metering is WEEKLY — the label always
 * says so. Never write "monthly" here.
 */

export interface AiCreditsMeterProps {
  /** From the settings payload (`settings.aiUsage`). null = unknown/unreadable. */
  usage: AiUsage | null | undefined;
  /** Settings still in flight — render the shape, not a wrong number. */
  loading?: boolean;
  /** The user has their OWN key: the free meter is no longer what powers their
   * chat, so it drops to muted, non-primary colors instead of shouting. */
  dim?: boolean;
  className?: string;
}

/** "312 of 1,000 credits used · resets Monday" + a slim progress bar. */
export function AiCreditsMeter({ usage, loading, dim, className }: AiCreditsMeterProps) {
  const view = toCreditsView(usage);

  if (loading || !view) {
    // No meter to show yet (or ever, if the read failed): a quiet placeholder
    // keeps the block's height stable so the card doesn't jump when it lands.
    return (
      <div className={cn("space-y-1.5", className)} aria-hidden>
        <div className="h-3.5 w-40 rounded bg-muted" />
        <div className="h-1.5 w-full rounded-full bg-muted" />
      </div>
    );
  }

  const { usedCredits, limitCredits, percentUsed, exhausted, resetsAt } = view;
  const days = daysUntilReset(resetsAt);
  const resetTitle = `Free credits reset every Monday at 00:00 UTC — next in ${days} day${
    days === 1 ? "" : "s"
  }`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className={cn("font-medium tabular-nums", dim && "text-muted-foreground")}>
          {formatCredits(usedCredits)} of {formatCredits(limitCredits)}
        </span>
        <span className="text-muted-foreground">credits used this week</span>
        <span className="ml-auto shrink-0 text-muted-foreground" title={resetTitle}>
          resets Monday
        </span>
      </div>
      {/* Slim bar. role=progressbar (not a bare div) so the number is available
          to assistive tech without duplicating the label above it. */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Free AI credits used this week"
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
            exhausted ? "bg-amber-500" : dim ? "bg-muted-foreground/40" : "bg-primary",
          )}
          // Floor of 2% so any nonzero spend is visibly a sliver rather than
          // nothing at all — an empty bar next to "3 of 1,000 used" reads broken.
          style={{ width: `${percentUsed > 0 ? Math.max(2, percentUsed) : 0}%` }}
        />
      </div>
      {exhausted && (
        <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
          You&apos;ve used this week&apos;s free credits. Add your own API key to keep going now, or
          wait for Monday&apos;s reset.
        </p>
      )}
    </div>
  );
}

export interface AiCreditsCalloutProps extends AiCreditsMeterProps {
  /** Overrides the hero line's title (default "Free AI included"). */
  title?: string;
  /** One line under the title. Defaults to the shared free-tier pitch. */
  description?: string;
  /** Trailing affordance — e.g. "or use your own key →". */
  action?: React.ReactNode;
  /** Renders a × in the corner (the chat greeting is dismissible). */
  onDismiss?: () => void;
}

/**
 * The credits meter as a marketed BLOCK: sparkle badge, "Free AI included", the
 * one-line pitch, then the meter. This is the free-tier-first hero the owner
 * asked for — it leads on every AI surface, with "use your own provider" as the
 * secondary, collapsed option beneath it.
 */
export function AiCreditsCallout({
  usage,
  loading,
  dim,
  title = "Free AI included",
  description = "Chat and answers run on our shared AI — no setup needed.",
  action,
  onDismiss,
  className,
}: AiCreditsCalloutProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        // Emphasis is the whole point when this is the active path; a dimmed
        // callout (user has their own key) drops the primary tint entirely.
        dim ? "border-border bg-muted/30" : "border-primary/30 bg-primary/[0.04]",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            dim ? "bg-muted" : "bg-primary/10",
          )}
        >
          <Sparkles
            className={cn("size-4", dim ? "text-muted-foreground" : "text-primary")}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="cursor-pointer -mr-1 -mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <AiCreditsMeter usage={usage} loading={loading} dim={dim} className="mt-2.5" />
      {action && <div className="mt-2 flex items-center gap-2 text-xs">{action}</div>}
    </div>
  );
}
