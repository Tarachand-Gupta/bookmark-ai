import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth, useClerk } from "@clerk/expo";

/**
 * Finishes a native SSO sign-in that Clerk already completed SERVER-side but
 * hasn't handed back to us yet — without waiting on `startSSOFlow` to resolve.
 *
 * ── Why this exists (measured in the installed SDKs, not inferred) ───────────
 * Verified against @clerk/clerk-expo 2.19.31 and the @clerk/clerk-js 5.127.0 it
 * bundles (`dist/hooks/useSSO.js`, `dist/clerk.headless.browser.js`); re-read
 * against @clerk/expo 4.6.5 (`dist/hooks/useSSO.js`, backed by the Core 2
 * hooks from `@clerk/react/legacy` + @clerk/clerk-js 6.25.6): the stable
 * `useSSO` is the SAME sequence — `signIn.create({ strategy, redirectUrl })`,
 * `openAuthSessionAsync`, then `signIn.reload({ rotatingTokenNonce })` — and
 * still does not activate a completed session on its own (only the
 * `@clerk/expo/experimental` useSSO does), so every point below still holds:
 *
 *  1. On iOS `WebBrowser.openAuthSessionAsync` resolves from the native
 *     ASWebAuthenticationSession completion handler, so once the sheet is off
 *     screen that part is already done. The wait is AFTER it: `useSSO` then
 *     awaits `signIn.reload({ rotatingTokenNonce })` — a GET.
 *  2. clerk-js wraps every GET in a retry ladder:
 *     `fetchMaxTries = onLine ? 4 : 11`, `initialDelay: 700`, `factor: 2`,
 *     `maxDelayBetweenRetries: 5000`, jittered, `retryImmediately: true`.
 *     React Native has no `navigator.onLine`, so the ELEVEN-try branch is the
 *     one that applies — ~40s worst case, and a couple of failed attempts (very
 *     likely right as the auth sheet tears the app's sockets down) is already
 *     10-20s of completely silent backoff.
 *  3. Worse: when clerk-js decides it is offline, `_baseFetch` returns `null`,
 *     so `reload()` resolves with the resource UNCHANGED and no error at all —
 *     `createdSessionId` comes back null and the flow can never be finished.
 *  4. clerk-expo 2.19.31 has no AppState/foreground client refresh (grep its
 *     dist), so nothing else notices the session that already exists. Force
 *     quitting and relaunching shows the user signed in — which is exactly the
 *     bug report this hook answers.
 *
 * Upstream's own fix for the same gap ships only as the EXPERIMENTAL `useSSO`
 * (`@clerk/expo/experimental`, "activates completed SSO sessions
 * automatically"), built on the Core 3 resources this screen does not use. This
 * is that behaviour, written against the stable Core 2 API.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * Armed before the browser sheet opens. When the app returns to the foreground
 * it reports a "finishing" phase and, on its own schedule, asks Clerk for the
 * current client until a session appears, then activates it. The caller's
 * `startSSOFlow` promise may still be stuck in the ladder above; it stops
 * mattering, because whichever path gets there first flips the auth gate.
 *
 * Silence is deliberate: a user who CANCELLED must never see an error, so a
 * timeout only surfaces one when there is real evidence the OAuth leg ran.
 */

/**
 * How long after returning to the foreground before we admit to "finishing".
 * A cancel resolves `startSSOFlow` almost immediately and disarms us, so this
 * grace keeps a deliberate cancel from flashing "Finishing sign-in…" on its way
 * back to the form.
 */
const FOREGROUND_GRACE_MS = 600;

/** Gap between attempts. Each attempt is one client refresh, so this also caps
 * how much extra traffic a stalled sign-in can generate. */
const POLL_INTERVAL_MS = 1_200;

/**
 * Per-attempt deadline. THIS is what sidesteps the stall: a fresh
 * `client.reload()` that is itself slow gets abandoned after 2.5s and the next
 * tick starts a NEW request, rather than inheriting the 5s-and-growing backoff
 * sleep the stuck request is sitting in. Abandoning is harmless — the request
 * either lands late (updating the same client) or fails silently.
 */
const ATTEMPT_TIMEOUT_MS = 2_500;

/** Total budget before giving up: long enough to cover the retry ladder's
 * realistic range, short enough that a genuinely broken flow reports itself. */
const MAX_WAIT_MS = 20_000;

export type FinishPhase =
  /** Not waiting on anything. */
  | "idle"
  /** Back in the app with an auth attempt outstanding — show progress. */
  | "finishing"
  /** The OAuth leg demonstrably ran, but we could not finish it. */
  | "failed";

export interface FinishPendingSession {
  phase: FinishPhase;
  /**
   * Whether the external browser flow actually took over the screen. Call it
   * (it is ref-backed, so it is never stale inside an async handler) to decide
   * whether a `startSSOFlow` rejection is worth showing: a throw AFTER the
   * sheet ran may still be a recoverable session, while a throw before it ever
   * opened is a real, immediate error.
   */
  sawExternalFlow: () => boolean;
  /** Call immediately before opening the auth sheet. */
  arm: () => void;
  /** Call once the flow has been dealt with (activated, or cancelled). */
  disarm: () => void;
}

/** Bound one attempt. Does not cancel the underlying work — nothing here can. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    const settle = (value: T | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(null));
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useFinishPendingSession(): FinishPendingSession {
  const clerk = useClerk();
  const { isSignedIn } = useAuth();
  const [phase, setPhase] = useState<FinishPhase>("idle");

  /** A flow is outstanding. */
  const armed = useRef(false);
  /** The app went inactive — i.e. the auth sheet really did take the screen. */
  const leftApp = useRef(false);
  /** …and came back. */
  const returned = useRef(false);
  /** A watcher is already running; never start a second one. */
  const running = useRef(false);
  // Read inside the async watcher, where a captured render value would be stale.
  const signedIn = useRef(isSignedIn);
  signedIn.current = isSignedIn;

  const watch = useCallback(async () => {
    // Give a cancel the chance to disarm us before we claim to be finishing.
    await wait(FOREGROUND_GRACE_MS);
    if (!armed.current) {
      running.current = false;
      return;
    }
    setPhase("finishing");

    const deadline = Date.now() + MAX_WAIT_MS;
    /** Did the OAuth leg demonstrably get somewhere? Decides error vs silence. */
    let evidence = false;
    /** We finished the job ourselves (as opposed to being disarmed, or giving up). */
    let activated = false;

    while (armed.current && Date.now() < deadline) {
      // Cheapest check first: the caller's own flow (or any other client
      // update) may already have signed us in.
      if (signedIn.current || clerk.session) break;

      const client = clerk.client;
      if (client) {
        // A FRESH request each tick — never a wait on the stuck one.
        await withTimeout(client.reload(), ATTEMPT_TIMEOUT_MS);
        if (!armed.current) break;

        const { signIn, signUp } = client;
        // Only an OAUTH verification counts: the client's signIn resource can
        // still be carrying a verified email-code factor from an earlier
        // attempt on this screen, and mistaking that for progress would put an
        // error on a flow the user simply cancelled.
        const firstFactor = signIn?.firstFactorVerification;
        const externalAccount = signUp?.verifications?.externalAccount?.status;
        if (
          (firstFactor?.strategy?.startsWith("oauth") === true &&
            firstFactor.status != null &&
            firstFactor.status !== "unverified") ||
          (externalAccount != null && externalAccount !== "unverified")
        ) {
          evidence = true;
        }

        const sessionId =
          signIn?.createdSessionId ??
          signUp?.createdSessionId ??
          client.lastActiveSessionId ??
          client.signedInSessions?.[0]?.id ??
          null;

        if (sessionId) {
          evidence = true;
          try {
            await clerk.setActive({ session: sessionId });
            activated = true;
            break;
          } catch (err) {
            // Not fatal: a session that is not activatable yet can become
            // activatable on a later tick. Keep going until the budget runs out.
            console.warn("[sso] setActive failed, retrying:", err);
          }
        }
      }

      await wait(POLL_INTERVAL_MS);
    }

    running.current = false;
    // Out of budget with nothing to show for it? Only a flow we can PROVE
    // progressed earns an error — a cancel leaves no evidence and stays silent.
    // `returned` is deliberately NOT reset here: the caller still consults
    // sawExternalFlow() if its own promise resolves late.
    const gaveUp = armed.current && !activated && !signedIn.current && !clerk.session;
    armed.current = false;
    setPhase(gaveUp && evidence ? "failed" : "idle");
  }, [clerk]);

  // Kept in a ref so the AppState subscription below can stay mounted once and
  // still call the current implementation.
  const watchRef = useRef(watch);
  watchRef.current = watch;

  // iOS reports `inactive` (not `background`) while ASWebAuthenticationSession
  // is presented, so any non-active state counts as "we left the app".
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!armed.current) return;
      if (state !== "active") {
        leftApp.current = true;
        return;
      }
      if (!leftApp.current || running.current) return;
      returned.current = true;
      running.current = true;
      void watchRef.current();
    });
    return () => sub.remove();
  }, []);

  const arm = useCallback(() => {
    armed.current = true;
    leftApp.current = false;
    returned.current = false;
    setPhase("idle");
  }, []);

  const disarm = useCallback(() => {
    armed.current = false;
    leftApp.current = false;
    returned.current = false;
    setPhase((current) => (current === "failed" ? current : "idle"));
  }, []);

  const sawExternalFlow = useCallback(() => returned.current, []);

  return { phase, sawExternalFlow, arm, disarm };
}
