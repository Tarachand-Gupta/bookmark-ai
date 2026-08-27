"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Puzzle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EXTENSION_CARD_DISMISSED_KEY,
  MOBILE_APP_DISMISSED_KEY,
  isMobilePlatform,
} from "@/lib/dashboard";
import { ExtensionStoreButton, useExtensionInstalled } from "@/components/library/extension-cta";
import { DashboardCard } from "./dashboard-card";
import { DismissButton } from "./dismiss-button";

/**
 * The install nudge — ONE card, one per platform, in the grid's last slot.
 *
 * Which one you get is a platform decision, not a preference:
 *  - **desktop browser, extension not detected** → "Install the extension".
 *    Detection is the app's existing `useExtensionInstalled()` (marker attribute
 *    on Firefox/Safari, `externally_connectable` ping on Chromium, plus a
 *    localStorage memo) — see lib/extension-detect.ts. Installed ⇒ this card
 *    never renders.
 *  - **phone or tablet** → "Get the mobile app". NEVER the extension card:
 *    no mobile browser we support installs one, so offering a store button
 *    there is an offer the browser can't accept.
 *
 * Both are client-only decisions and render NOTHING until they settle — the
 * server has neither a `navigator` nor a `localStorage`, and a card that paints
 * and then swaps or vanishes is worse than one that arrives a beat late. In
 * practice the mobile branch settles in one effect tick; the desktop branch can
 * take up to the detector's ~8s budget on a cold service worker, which is
 * exactly the flash we're avoiding.
 *
 * The grid stays geometry-stable either way: this is one more equal-width cell
 * that either exists or doesn't (see dashboard-page's grid comment). No
 * col-spans, no "fill the gap" logic.
 */
export function InstallCard({ className }: { className?: string }) {
  const platform = usePlatform();
  if (platform === null) return null;
  return platform === "mobile" ? (
    <MobileAppCard className={className} />
  ) : (
    <ExtensionInstallCard className={className} />
  );
}

/**
 * Where "get the app" points. There is no listing yet, so it's the public repo.
 *
 * TODO: swap for TestFlight/App Store when it exists.
 */
export const MOBILE_APP_URL = "https://github.com/Tarachand-Gupta/bookmark-ai";

/* ── Desktop: install the extension ───────────────────────────────────────── */

function ExtensionInstallCard({ className }: { className?: string }) {
  const installed = useExtensionInstalled();
  const [dismissed, dismiss] = useDismissFlag(EXTENSION_CARD_DISMISSED_KEY);

  // `installed === null` is "still detecting", which shows nothing — same rule
  // the setup strip used to apply, for the same reason: an install prompt shown
  // to someone who already installed is the one failure mode worth waiting for.
  if (installed !== false || dismissed !== false) return null;

  return (
    <DashboardCard
      title="Install the extension"
      Icon={Puzzle}
      headerAction={<DismissButton label="Dismiss install prompt" onClick={dismiss} />}
      className={className}
    >
      <p className="text-sm text-muted-foreground">
        Save any page — and whole windows of tabs — in one click.
      </p>
      <ExtensionStoreButton size="sm" variant="outline" className="mt-3" />
    </DashboardCard>
  );
}

/* ── Mobile: get the app ──────────────────────────────────────────────────── */

function MobileAppCard({ className }: { className?: string }) {
  const [dismissed, dismiss] = useDismissFlag(MOBILE_APP_DISMISSED_KEY);
  // No detection here on purpose: mobile web has NO reliable way to tell whether
  // a native app is installed. (Probing a custom scheme navigates or stalls the
  // page, `getInstalledRelatedApps()` is Chromium/Android-only and needs a
  // manifest relationship we don't have, and universal links tell you nothing
  // from inside the browser.) So the dismiss IS the "I already have it" signal.
  if (dismissed !== false) return null;

  return (
    <DashboardCard
      title="Get the mobile app"
      Icon={Smartphone}
      headerAction={<DismissButton label="Dismiss app prompt" onClick={dismiss} />}
      className={className}
    >
      <p className="text-sm text-muted-foreground">Save bookmarks straight from the share sheet.</p>
      <Button asChild size="sm" variant="outline" className="mt-3">
        <a href={MOBILE_APP_URL} target="_blank" rel="noreferrer">
          {/* Not Smartphone again — that's the card's own header icon. */}
          <Download aria-hidden />
          Get the app
        </a>
      </Button>
    </DashboardCard>
  );
}

/* ── Client-only state ────────────────────────────────────────────────────── */

/** `"mobile"` / `"desktop"`, or `null` until the first effect runs — reading
 * `navigator` during render would make the server and the client disagree about
 * which card exists, which is a hydration mismatch, not a flash. */
function usePlatform(): "mobile" | "desktop" | null {
  const [platform, setPlatform] = useState<"mobile" | "desktop" | null>(null);
  useEffect(() => {
    const nav = typeof navigator === "undefined" ? null : navigator;
    setPlatform(isMobilePlatform(nav) ? "mobile" : "desktop");
  }, []);
  return platform;
}

/**
 * A remembered dismissal. `null` while unread (render nothing), then
 * `true`/`false`. Same shape as the setup strip's flag, minus the strip's
 * two-verdict special case — here one "×" settles one card.
 */
function useDismissFlag(key: string): [boolean | null, () => void] {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(key) === "1");
    } catch {
      // Storage disabled (private-mode Safari) — treat as not dismissed.
      setDismissed(false);
    }
  }, [key]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Best effort — it reappears next visit, which is acceptable.
    }
  }, [key]);

  return [dismissed, dismiss];
}
