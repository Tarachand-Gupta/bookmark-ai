"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The dashboard's ONE dismiss "×".
 *
 * Two hand-rolled copies of this button used to live in the setup card and the
 * MCP promo — same glyph, same job, two slightly different class strings. It's a
 * button, so it wears `buttonVariants` (ghost/icon-sm) like every other control
 * on the page instead of a bespoke one.
 */
export function DismissButton({
  label,
  onClick,
  className,
}: {
  /** Accessible name AND tooltip — an icon-only control has no other one. */
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <X aria-hidden />
    </Button>
  );
}
