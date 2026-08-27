import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The confirmation card's AI-enrichment chips. `category` is the one emphasized
 * chip (primary fill, the payoff of the save); `tag` is the quiet muted chip.
 */
export function Pill({
  tone = "tag",
  className,
  children,
}: {
  tone?: "category" | "tag";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px]",
        tone === "category"
          ? "bg-primary font-semibold text-primary-foreground"
          : "bg-muted font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
