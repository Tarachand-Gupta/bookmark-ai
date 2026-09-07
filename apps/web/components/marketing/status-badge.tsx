import { cn } from "@/lib/utils";
import type { PlatformStatus } from "@/lib/platforms";
import { mono } from "./primitives";

/**
 * The availability pill. Tone follows the status, not the text: a live beta is
 * quiet and solid, "under review" carries a pulsing dot (something is in
 * motion), "coming soon" is dashed — an outline of a thing that isn't here yet.
 */
export function StatusBadge({
  status,
  children,
  className,
}: {
  status: PlatformStatus;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        mono,
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[10.5px] font-medium uppercase tracking-[0.16em]",
        status === "available" && "border-foreground/15 bg-foreground/[0.06] text-foreground dark:bg-foreground/[0.1]",
        status === "review" && "border-border bg-background/40 text-muted-foreground",
        status === "soon" && "border-dashed border-border bg-transparent text-muted-foreground",
        className,
      )}
    >
      {status === "review" && (
        <span aria-hidden className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/50 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-foreground/70" />
        </span>
      )}
      {children}
    </span>
  );
}
