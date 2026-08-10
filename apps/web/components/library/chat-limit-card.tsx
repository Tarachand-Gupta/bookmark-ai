"use client";

import { KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCredits, tokensToCredits } from "@/lib/ai-credits";

export interface ChatLimitInfo {
  usedTokens?: number;
  limitTokens?: number;
}

export interface ChatLimitCardProps {
  info: ChatLimitInfo;
  /** Opens the AiSetupCard flow so the user can add their own (unmetered) key. */
  onConfigure: () => void;
}

/**
 * Inline "you've hit the free AI budget" card, rendered in the thread when
 * POST /api/chat 402s with `error: "free-limit-exceeded"`. The CTA opens the
 * SAME AiSetupCard the rest of the app uses — once a key is saved the send can
 * be retried and runs unmetered against the user's own provider.
 */
export function ChatLimitCard({ info, onConfigure }: ChatLimitCardProps) {
  // Credits, not tokens — same 1,000-tokens-per-credit rate the meters use
  // (lib/ai-credits.ts), so the wall's numbers match what the user was watching
  // count up. The wire payload is tokens because that's what the server meters.
  const used = formatCreditsOrUndefined(info.usedTokens);
  const limit = formatCreditsOrUndefined(info.limitTokens);
  return (
    <div className="not-prose w-full rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
          <Sparkles className="size-4 text-amber-600 dark:text-amber-500" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">This week&apos;s free credits are used up</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            Free credits reset every Monday. To keep chatting now, add your own API key — your key
            isn&apos;t metered.
          </p>
          {used && limit && (
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {used} of {limit} credits used this week
            </p>
          )}
          <Button size="sm" className="mt-3" onClick={onConfigure}>
            <KeyRound className="size-3.5" aria-hidden />
            Configure API key
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Tokens → a grouped credit count, or undefined when the 402 body omitted it
 * (the wall still renders, just without the numbers line). */
function formatCreditsOrUndefined(tokens: number | undefined): string | undefined {
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) return undefined;
  return formatCredits(tokensToCredits(tokens));
}
