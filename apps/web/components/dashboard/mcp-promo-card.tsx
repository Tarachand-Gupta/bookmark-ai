"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listMcpTokens } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MCP_PROMO_DISMISSED_KEY } from "@/lib/dashboard";
import type { SectionId } from "@/components/library/settings-dialog";

/**
 * "Connect any AI agent" — the dashboard's one-line pitch for the MCP server,
 * which is otherwise only discoverable from Settings (and now the sidebar's MCP
 * row). Deliberately a PROMO, not furniture: it disappears for good the moment
 * you mint a token, and it's dismissible before that.
 *
 * The visibility decision lives in `useMcpPromo` rather than inside the card,
 * because the dashboard grid also needs it: an invisible card still occupies a
 * column, which is exactly the dead space this pass is removing.
 */

export interface McpPromoState {
  /** Render the card: no live token, not dismissed, and we actually know both. */
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
  // Three states, not a boolean: "unknown" must not flash the card at a user who
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
          // life (the card can't come back for a user who has used MCP).
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
 * disabled the card reappears next visit, which is acceptable. */
function rememberResolved() {
  try {
    window.localStorage.setItem(MCP_PROMO_DISMISSED_KEY, "1");
  } catch {
    // Ignored on purpose.
  }
}

export function McpPromoCard({
  onDismiss,
  onOpenSettings,
  className,
}: {
  onDismiss: () => void;
  onOpenSettings: (section?: SectionId) => void;
  className?: string;
}) {
  return (
    // Dashed border, like the setup card: in this app that's the shape of
    // something that goes away, as opposed to a card that's part of the page.
    <section
      className={cn(
        "rounded-xl border border-dashed bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Connect any AI agent</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Your bookmarks, search, and library — available to Claude, Cursor, or any MCP client.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss MCP card"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={() => onOpenSettings("mcp")}
      >
        <Plug aria-hidden />
        Set up MCP
      </Button>
    </section>
  );
}
