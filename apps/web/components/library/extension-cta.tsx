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

/** Published extension ids per build target — each browser exposes exactly one,
 * so we ping all three and take the first that answers. */
const EXTENSION_IDS = [
  "ffhbgpgebpmofjkehpjcemepbgcmoelp", // prod
  "ljlfmaknohecakpdolffabmjdfikfjed", // dev
  "joillpelifndeefomeimoomlgoimbkei", // local
];

/** Overall budget for the ping round-trip before we conclude "not installed". A
 * cold extension service worker has to WAKE before it can answer the external
 * ping, which can take well over 400ms — the card hiding a beat later is better
 * than hiding never (a false "not installed"). */
const PING_TIMEOUT_MS = 1500;

interface ChromeRuntimeLike {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  /** Read (any access clears it) inside the callback to swallow the "Receiving
   * end does not exist" error Chrome sets when no extension answers. */
  lastError?: unknown;
}

/**
 * Whether an installed Bookmark AI extension is reachable from this origin.
 * `null` while checking; `false` once we've concluded none is present (or the
 * browser isn't Chrome). `window.chrome.runtime.sendMessage` exists only in
 * Chrome, and only reaches an extension whose `externally_connectable` matches
 * this origin — so a non-Chrome browser (no API) resolves `false` and keeps the
 * install card visible. Resolves `true` on the first `{ ok: true }` ping reply.
 */
export function useExtensionInstalled(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    const runtime = (window as Window & { chrome?: { runtime?: ChromeRuntimeLike } }).chrome
      ?.runtime;
    if (!runtime?.sendMessage) {
      setInstalled(false); // not Chrome, or no externally_connectable match
      return;
    }

    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      setInstalled(value);
    };
    const timer = setTimeout(() => finish(false), PING_TIMEOUT_MS);

    for (const id of EXTENSION_IDS) {
      try {
        runtime.sendMessage(id, { type: "BOOKMARK_AI_PING" }, (response) => {
          void runtime.lastError; // swallow "Receiving end does not exist"
          if (response && (response as { ok?: boolean }).ok) {
            clearTimeout(timer);
            finish(true);
          }
        });
      } catch {
        // sendMessage can throw synchronously (e.g. a malformed id) — ignore and
        // let the other ids / the timeout decide.
      }
    }

    return () => {
      done = true;
      clearTimeout(timer);
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
  // Hide once we've confirmed the extension is installed; keep showing while
  // that's unknown (null) or false, so non-Chrome users always see it.
  const installed = useExtensionInstalled();
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
      <ExtensionStoreButton size="sm" className="mt-2.5 w-full" />
    </div>
  );
}
