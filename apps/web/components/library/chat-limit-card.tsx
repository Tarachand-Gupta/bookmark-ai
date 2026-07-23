"use client";

import { KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const used = formatTokens(info.usedTokens);
  const limit = formatTokens(info.limitTokens);
  return (
    <div className="not-prose w-full rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex items-start gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
          <Sparkles className="size-4 text-amber-600 dark:text-amber-500" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Free AI limit reached</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            You exceeded the free AI usage limit. Configure your own API key to keep chatting.
          </p>
          {used && limit && (
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {used} / {limit} tokens used
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

/** "1,234" / "12.3k" / "1.2M" — compact token counts, or undefined when absent. */
function formatTokens(n: number | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
