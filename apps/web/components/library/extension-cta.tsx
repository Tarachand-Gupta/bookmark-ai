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
import {
  canPingExtension,
  DETECT_BUDGET_MS,
  detectLog,
  hasExtensionMarker,
  observeExtensionMarker,
  pingExtensionWithRetries,
  readInstalledMemo,
  sleep,
  writeInstalledMemo,
} from "@/lib/extension-detect";

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

/**
 * Whether an installed Bookmark AI extension can be detected from this origin.
 * `null` while checking; `false` once every channel has been exhausted.
 *
 * Two channels race (see lib/extension-detect.ts for why there are two): the
 * `<html>` marker attribute the Firefox/Safari builds stamp, and the Chrome
 * `externally_connectable` ping — the latter RETRIED across ~8s, because a cold
 * MV3 service worker regularly misses a single 1.5s attempt and the old
 * single-shot version then reported "not installed" for the whole mount.
 *
 * A remembered "installed" from a previous visit is applied optimistically so
 * the card doesn't flash while we re-verify; only a run that exhausts every
 * channel forgets it and shows the card again.
 */
export function useExtensionInstalled(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let found = false;
    const deadline = Date.now() + DETECT_BUDGET_MS;

    // Read the memo here rather than in a lazy `useState` initializer: the
    // server has no localStorage, so deciding this during render would make the
    // server and client disagree about whether the card exists.
    if (readInstalledMemo()) {
      detectLog("remembered installed — hiding card while re-verifying");
      setInstalled(true);
    }

    // Assigned right below; `markInstalled` may run before that only via the observer
    // callback, which cannot fire until the observer exists.
    let stopObserving = () => {};

    const markInstalled = (via: string) => {
      if (cancelled || found) return;
      found = true;
      detectLog(`installed via ${via}`);
      writeInstalledMemo(true);
      setInstalled(true);
      stopObserving();
    };

    // Start observing FIRST: a content script may stamp the marker at any point
    // in the budget (it runs at document_idle, which can be after we mount).
    stopObserving = observeExtensionMarker(() => markInstalled("marker (observed)"));

    void (async () => {
      if (hasExtensionMarker()) return markInstalled("marker");

      if (canPingExtension()) {
        if (await pingExtensionWithRetries(() => cancelled || found)) {
          return markInstalled("chrome ping");
        }
      } else {
        // Not Chromium, or no extension matched this origin in
        // externally_connectable — inconclusive, so let the marker window run.
        detectLog("no chrome ping channel on this browser");
      }

      // Both channels have had their say; give the observer the rest of the
      // budget (non-Chromium browsers get here almost immediately).
      const remaining = deadline - Date.now();
      if (remaining > 0) await sleep(remaining);
      if (cancelled || found) return;
      if (hasExtensionMarker()) return markInstalled("marker (late)");

      detectLog("not detected — showing install card");
      writeInstalledMemo(false); // a definitive miss forgets the memo
      setInstalled(false);
      stopObserving();
    })();

    return () => {
      cancelled = true;
      stopObserving();
    };
  }, []);

  return installed;
}

export interface ExtensionStoreButtonProps {
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}

/**
 * "Add to <Browser>" — the single way into the store listing. The sidebar card,
 * the first-run panel and the sessions empty state all render this one button.
 *
 * While the listing for this browser isn't live (under review / coming soon —
 * see lib/platforms.ts) the target is our own /download card, opened in the
 * same tab, and the label says "Install options" rather than promising a store
 * page that 404s.
 */
export function ExtensionStoreButton({
  size = "default",
  variant = "default",
  className,
}: ExtensionStoreButtonProps) {
  const target = useExtensionTarget();
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <a
        href={target.url}
        target={target.external ? "_blank" : undefined}
        rel={target.external ? "noreferrer" : undefined}
      >
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
  // Hide once we've confirmed the extension is installed; keep showing while
  // that's unknown (null) or false, so non-Chrome users always see it.
  const installed = useExtensionInstalled();
  const target = useExtensionTarget();
  if (installed === true) return null;
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
      {target.statusNote && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
          {target.statusNote}
        </p>
      )}
      <ExtensionStoreButton size="sm" className="mt-2.5 w-full" />
    </div>
  );
}
