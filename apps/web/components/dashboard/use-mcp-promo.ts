"use client";

import { useCallback, useEffect, useState } from "react";
import { listMcpTokens } from "@/lib/api";
import { MCP_PROMO_DISMISSED_KEY } from "@/lib/dashboard";

/**
 * Whether this account still needs the "connect an AI agent" pitch — one of the
 * steps in the setup strip (see setup-strip.tsx).
 *
 * Moved out of the old McpPromoCard unchanged when that card was folded into the
 * strip: the logic is a fetch + a localStorage verdict, not a card, and the
 * strip is now the only thing that reads it.
 */

export interface McpPromoState {
  /** Show the step: no live token, not dismissed, and we actually know both. */
  show: boolean;
  dismiss: () => void;
}

/**
 * Is this account already talking to an agent? One cheap GET, client-side and
 * lazily — deliberately NOT folded into /api/dashboard: the aggregator is on the
 * critical path for every visit, and a promo nobody needs after week one has no
 * business slowing it down.
 *
 * Any failure (offline, provisioning, 401 mid-session) resolves to "hide": this
 * page never shows an error card, and a promo is the last thing worth one.
 */
export function useMcpPromo(): McpPromoState {
  // Three states, not a boolean: "unknown" must not flash the step at a user who
  // already has tokens, and must not flash it at a dismissed one either.
  const [status, setStatus] = useState<"unknown" | "hide" | "show">("unknown");

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(MCP_PROMO_DISMISSED_KEY) === "1";
    } catch {
      // Storage disabled — treat as not dismissed and fall through to the fetch.
    }
    if (dismissed) {
      setStatus("hide");
      return;
    }
    const controller = new AbortController();
    listMcpTokens(controller.signal)
      .then(({ tokens }) => {
        // A revoked token is not a connected agent — it's the opposite.
        if (tokens.some((t) => !t.revokedAt)) {
          // Connected once ⇒ the pitch is answered for good, so it's recorded in
          // the same key a manual dismissal writes. That's what stops this
          // request from repeating on every visit for the rest of the account's
          // life (the step can't come back for a user who has used MCP).
          rememberResolved();
          setStatus("hide");
          return;
        }
        setStatus("show");
      })
      .catch(() => {
        // Aborted by the cleanup below (StrictMode's double-mount, or a real
        // unmount) is not a verdict — leave the state to the surviving effect.
        if (!controller.signal.aborted) setStatus("hide");
      });
    return () => controller.abort();
  }, []);

  const dismiss = useCallback(() => {
    setStatus("hide");
    rememberResolved();
  }, []);

  return { show: status === "show", dismiss };
}

/** Persist "this account is done with the MCP pitch". Best effort: with storage
 * disabled the step reappears next visit, which is acceptable. */
function rememberResolved() {
  try {
    window.localStorage.setItem(MCP_PROMO_DISMISSED_KEY, "1");
  } catch {
    // Ignored on purpose.
  }
}
