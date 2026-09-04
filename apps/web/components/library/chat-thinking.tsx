"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The instant placeholder for an assistant turn that has nothing to show yet
 * (status `submitted`, or `streaming` with no renderable part so far). A
 * shimmering "Thinking" label with three softly pulsing dots — the same
 * vocabulary the reasoning disclosure and running tool rows use, so the whole
 * turn reads as one system. Reduced motion: a still muted label and dots
 * (see `.text-shimmer` / `.thinking-dot` in globals.css).
 */
export function ThinkingIndicator({
  label = "Thinking",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-2 py-0.5 text-sm", className)}
      role="status"
      aria-live="polite"
    >
      <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-shimmer font-medium" aria-hidden>
        {label}
      </span>
      <span className="flex items-center gap-[3px] pt-px" aria-hidden>
        <span className="thinking-dot size-1 rounded-full bg-muted-foreground" />
        <span className="thinking-dot size-1 rounded-full bg-muted-foreground" />
        <span className="thinking-dot size-1 rounded-full bg-muted-foreground" />
      </span>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
