import { diag } from "./diag";

/**
 * MINT GATE — "don't re-mint a device token pointlessly" WITHOUT the permanent
 * latch that used to make one transient failure fatal.
 *
 * The original guard was `let mintAttempted = false`, flipped to true right
 * BEFORE the mint request. So an offline moment, a 502, or a Clerk hiccup blocked
 * every further mint for the lifetime of the background context. On Chrome's MV3
 * worker that lifetime is minutes, so it mostly healed by accident; on FIREFOX
 * MV2 the background page is PERSISTENT — it lives as long as the browser — so a
 * single failed mint meant the install would never get a device token again, and
 * the user was back to "open the web app to fix your 401s".
 *
 * The fix: latch only on SUCCESS, and treat failure as a short backoff. A forced
 * attempt (401 recovery) ignores both.
 *
 * Deliberately worker-local (not storage-backed): the success latch is a
 * per-context "we already did this", and a backoff that outlived the context
 * would be indistinguishable from the permanent latch we're removing.
 */

/** After a failed mint request, wait this long before trying again. */
export const MINT_RETRY_BACKOFF_MS = 10 * 60 * 1000;

export class MintGate {
  private minted = false;
  private nextAttemptAt = 0;

  /** `label` prefixes this gate's diag breadcrumbs (e.g. "mint", "bridge mint"). */
  constructor(private readonly label: string) {}

  /** True when a mint should be skipped: already succeeded this context, or the
   * post-failure backoff hasn't elapsed. */
  blocked(now: number = Date.now()): boolean {
    if (this.minted) return true;
    if (now < this.nextAttemptAt) {
      diag("deviceToken", `${this.label}: backoff`, { retryInMs: this.nextAttemptAt - now });
      return true;
    }
    return false;
  }

  /** A token is stored — stop trying for this context. */
  succeeded(): void {
    this.minted = true;
    this.nextAttemptAt = 0;
  }

  /** The mint REQUEST failed (bad status, unparseable body, network error). Back
   * off instead of latching, so the next alarm/popup/401 can retry. */
  failed(now: number = Date.now()): void {
    this.nextAttemptAt = now + MINT_RETRY_BACKOFF_MS;
  }

  /** Drop both the success latch and the backoff — used by forced re-mints, where
   * the caller already knows the current credential is rejected. */
  reset(): void {
    this.minted = false;
    this.nextAttemptAt = 0;
  }
}
