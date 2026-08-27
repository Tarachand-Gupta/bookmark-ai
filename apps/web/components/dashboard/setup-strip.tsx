"use client";

import { useEffect, useState } from "react";
import { Link2, Plug, Radio, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SETUP_DISMISSED_KEY } from "@/lib/dashboard";
import type { SectionId } from "@/components/library/settings-dialog";
import { DismissButton } from "./dismiss-button";
import { useMcpPromo } from "./use-mcp-promo";

/**
 * Everything this account still has to switch on, as ONE quiet strip under the
 * grid — the merged former SetupCard (first save / live sessions) and
 * McpPromoCard (connect an agent).
 *
 * The extension step LEFT this strip on 2026-08-27: the grid's install card
 * (install-card.tsx) owns that nudge now, and one prompt in two places is
 * exactly the duplication this redesign was for. For most accounts that makes
 * the strip empty — which is correct: it renders null.
 *
 * Why one strip: those were two dashed cards in two different columns, each with
 * its own dismiss "×", its own heading, and — in the setup card's case — four
 * different tile geometries depending on how many steps were left. Between them
 * they were the loudest thing on a page whose actual content is four cards.
 *
 * Shape rules: one LINE per step, one `outline` action per step, one shared
 * dismiss for the lot. It renders nothing at all once every step is done or the
 * strip is dismissed — at which point the grid is the whole page, which is the
 * steady state this dashboard is designed around.
 */
export function SetupStrip({
  totalBookmarks,
  liveEnabled,
  onAdd,
  onOpenSettings,
  className,
}: {
  totalBookmarks: number;
  /** From the live hook: true/false when known, null when live is unreachable or
   * still loading — unknown never produces a step (we don't guess, and we never
   * surface live failures here). */
  liveEnabled: boolean | null;
  onAdd: () => void;
  onOpenSettings: (section?: SectionId) => void;
  className?: string;
}) {
  const mcp = useMcpPromo();
  // Read in an effect, not during render: no localStorage on the server.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(SETUP_DISMISSED_KEY) === "1");
    } catch {
      // Storage disabled — treat as not dismissed.
    }
  }, []);

  const steps: Step[] = [];
  // NO "install the extension" step. It moved to the install card in the grid
  // (install-card.tsx) on 2026-08-27, because the same nudge in two places is
  // the duplication this redesign exists to remove — and the card can carry the
  // pitch and the store button, which a one-line step could not.
  if (totalBookmarks === 0) {
    steps.push({
      key: "first-save",
      label: "Save your first bookmark",
      hint: "Or paste a URL to try it now.",
      action: (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Link2 aria-hidden />
          Add a URL
        </Button>
      ),
    });
  }
  if (liveEnabled === false) {
    steps.push({
      key: "live",
      label: "Turn on live sessions",
      hint: "See the tabs open on your other devices.",
      action: (
        <Button size="sm" variant="outline" onClick={() => onOpenSettings("devices")}>
          <Radio aria-hidden />
          Enable
        </Button>
      ),
    });
  }
  if (mcp.show) {
    steps.push({
      key: "mcp",
      label: "Connect an AI agent",
      hint: "Your library, available to Claude, Cursor, or any MCP client.",
      action: (
        <Button size="sm" variant="outline" onClick={() => onOpenSettings("mcp")}>
          <Plug aria-hidden />
          Set up MCP
        </Button>
      ),
    });
  }

  if (dismissed || steps.length === 0) return null;

  // One "×" for one strip: dismissing it settles BOTH stored verdicts, because
  // from the user's side there is one thing on screen to make go away.
  const dismissAll = () => {
    setDismissed(true);
    mcp.dismiss();
    try {
      window.localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    } catch {
      // Best effort — it'll reappear next visit, which is acceptable.
    }
  };

  return (
    <section
      className={cn(
        "rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Rocket className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          Finish setting up
        </h2>
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{steps.length}</span>
        <DismissButton label="Dismiss setup" onClick={dismissAll} />
      </div>
      <ul className="mt-1 divide-y">
        {steps.map((step) => (
          <li key={step.key} className="flex min-w-0 items-center gap-3 py-2">
            <p className="min-w-0 flex-1 truncate">
              <span className="text-sm font-medium">{step.label}</span>
              {/* The hint rides the SAME line and truncates with it — a second
                  line per step is what turned the old card into a wall. */}
              <span className="ml-2 text-xs text-muted-foreground">{step.hint}</span>
            </p>
            <span className="shrink-0">{step.action}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Step {
  key: string;
  label: string;
  hint: string;
  action: React.ReactNode;
}
