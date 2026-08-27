import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { diag } from "@/lib/diag";
import { requestUser, type UserInfo } from "@/lib/messages";

/**
 * The popup's auth gate, lifted out of `App` so the component is layout and the
 * hook is plumbing. Behavior is unchanged from the pre-redesign App:
 *
 *  - ask the background on mount (it owns the Clerk client, so it is the
 *    authority on the mirrored web session);
 *  - re-ask on `visibilitychange`, so returning from the sign-in tab promotes
 *    the popup without a reopen;
 *  - poll every 2s ONLY while the signed-out gate is up;
 *  - stop spinning after a 5s boot budget and show the gate with a "degraded"
 *    note, because a background that can't resolve auth in a few seconds should
 *    still leave the user something actionable.
 */

/** Re-check auth while the signed-out gate is up. */
const AUTH_POLL_MS = 2000;
/** How long to wait for the background's first `GET_USER` answer before giving
 * up and showing the signed-out gate instead of the spinner. The background can
 * hang indefinitely (e.g. `@clerk/chrome-extension`'s client never settling
 * under Safari), which would otherwise leave `auth` null and the popup spinning
 * forever. */
const BOOT_TIMEOUT_MS = 5000;

export const SIGNED_OUT: UserInfo = { signedIn: false, name: null, email: null };

/** Popup-side probe of the background page's liveness — the decisive signal for
 * "does Safari actually run the MV2 background script?". `getBackgroundPage` is
 * MV2-only (absent on MV3/Chrome) and may be disallowed on Safari, so it's fully
 * guarded. `hasBackgroundVar` checks the bundle's top-level `var background`,
 * i.e. whether background.js evaluated at all. Lands in the dev log on any popup
 * open — no browser console needed. */
async function probeBackground(): Promise<void> {
  try {
    const getBg = (
      browser.runtime as unknown as {
        getBackgroundPage?: () => Promise<(Window & { background?: unknown }) | null>;
      }
    ).getBackgroundPage;
    if (typeof getBg !== "function") {
      diag("popup", "bg probe", { getBackgroundPage: false });
      return;
    }
    const w = await getBg();
    diag("popup", "bg probe", {
      gotWindow: !!w,
      hasBackgroundVar: w ? "background" in w : null,
      readyState: w?.document?.readyState ?? null,
      scriptCount: w?.document?.scripts?.length ?? null,
    });
  } catch (e) {
    diag("popup", "bg probe", { err: e instanceof Error ? e.message : String(e) });
  }
}

export interface AuthState {
  /** `null` = still resolving; the gate/full UI only render once it settles. */
  auth: UserInfo | null;
  /** The boot budget expired before any background answer — the gate shows a
   * note so a stuck background reads as a state, not a bug. */
  degraded: boolean;
  /** Lets sign-out drop straight back to the gate without waiting for a poll. */
  setAuth: (info: UserInfo) => void;
}

export function useAuth(): AuthState {
  const [auth, setAuth] = useState<UserInfo | null>(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    diag("popup", "mount");
    void probeBackground();
    let alive = true;
    let responded = false;
    const check = () => {
      void requestUser().then((info) => {
        if (!alive) return;
        responded = true;
        diag("popup", "auth resolved", { signedIn: info.signedIn });
        setAuth(info);
      });
    };
    check();
    // Safety net: if the background never answers within the budget, stop
    // spinning and show the signed-out gate. The 2s auth poll below keeps
    // retrying, so a later recovery or a real sign-in still promotes the popup.
    const bootTimer = window.setTimeout(() => {
      if (!alive || responded) return;
      diag("popup", "boot timeout fired");
      setDegraded(true);
      setAuth(SIGNED_OUT);
    }, BOOT_TIMEOUT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(bootTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Poll ONLY while the signed-out gate is showing. `auth?.signedIn` stays false
  // across signed-out re-checks, so the interval persists; it clears the moment
  // sign-in flips it true (or while auth is still loading/undefined).
  useEffect(() => {
    if (!auth || auth.signedIn) return;
    const id = window.setInterval(() => {
      void requestUser().then((info) => {
        diag("popup", "poll", { signedIn: info.signedIn });
        setAuth(info);
      });
    }, AUTH_POLL_MS);
    return () => window.clearInterval(id);
  }, [auth?.signedIn]);

  return { auth, degraded, setAuth };
}
