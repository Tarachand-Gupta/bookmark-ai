"use client";

import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  detectExtensionTarget,
  GENERIC_EXTENSION_TARGET,
  type ExtensionTarget,
} from "@/lib/extension-links";

/**
 * The store target for the current browser.
 *
 * Detection needs `navigator`, which the server doesn't have, so the first pass
 * renders the generic label and the detected one lands in an effect. Detecting
 * during render instead would make the server say "Get the extension" and the
 * client say "Add to Chrome" — a hydration mismatch.
 */
export function useExtensionTarget(): ExtensionTarget {
  const [target, setTarget] = useState<ExtensionTarget>(GENERIC_EXTENSION_TARGET);
  useEffect(() => setTarget(detectExtensionTarget()), []);
  return target;
}

export interface ExtensionStoreButtonProps {
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}

/**
 * "Add to <Browser>" — the single way into the store listing. The sidebar card,
 * the first-run panel and the sessions empty state all render this one button.
 */
export function ExtensionStoreButton({
  size = "default",
  variant = "default",
  className,
}: ExtensionStoreButtonProps) {
  const target = useExtensionTarget();
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a href={target.url} target="_blank" rel="noreferrer">
        <Puzzle aria-hidden />
        {target.label}
      </a>
    </Button>
  );
}

/**
 * The sidebar-footer card. Stays put once the library has bookmarks — a user
 * with a full library still wants the extension on their second browser.
 */
export function ExtensionCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // Hidden when the sidebar is railed down to icons — same idiom the
        // shadcn sidebar primitives use for their own text-bearing bits.
        "rounded-lg border bg-sidebar-accent/40 p-3 group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      <p className="text-sm font-medium">Get the extension</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Save any page — and whole windows of tabs — in one click.
      </p>
      <ExtensionStoreButton size="sm" className="mt-2.5 w-full" />
    </div>
  );
}
