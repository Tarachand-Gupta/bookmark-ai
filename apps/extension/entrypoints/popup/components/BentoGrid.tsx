import type { LiveState } from "../use-live";
import { hostLabel } from "../nav";
import { Tile, TileLabel } from "./ui/tile";
import { SwitchPill } from "./ui/switch-pill";
import { ExternalLinkIcon, LayersCheckIcon, LayersIcon, RadioIcon } from "./ui/icons";
import { Spinner } from "./Spinner";

/**
 * The four secondary actions as one 2×2 bento. Every tile is a real `<button>`
 * whose whole 64px surface is the target — no nested links, no bespoke class
 * strings (all four share `Tile`).
 *
 * The live tile is the only compound one: its SWITCH flips publishing on/off and
 * its BODY expands the tile into the full live panel. They are SIBLING buttons in
 * a relative wrapper, never a button inside a button, so screen readers get two
 * plain controls instead of an ambiguous nested one.
 */
export function BentoGrid({
  tabCount,
  savingSession,
  savingSessionClose,
  busy,
  webUrl,
  live,
  onSaveSession,
  onSaveAndClose,
  onOpenApp,
}: {
  tabCount: number | null;
  savingSession: boolean;
  savingSessionClose: boolean;
  busy: boolean;
  webUrl: string;
  live: LiveState;
  onSaveSession: () => void;
  onSaveAndClose: () => void;
  onOpenApp: () => void;
}) {
  const tabs = tabCount ?? 0;
  const tabLabel = `${tabs} tab${tabs === 1 ? "" : "s"}`;
  const noTabs = !tabCount;

  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile onClick={onSaveSession} disabled={busy || noTabs} aria-label="Save session, keep tabs open">
        {savingSession ? (
          <Spinner />
        ) : (
          <LayersIcon className="size-[18px] text-foreground" strokeWidth={1.8} />
        )}
        <TileLabel
          label="Save session"
          meta={savingSession ? "Saving…" : `${tabLabel}, stays open`}
        />
      </Tile>

      <Tile onClick={onSaveAndClose} disabled={busy || noTabs} aria-label="Save session, then close the window">
        {savingSessionClose ? (
          <Spinner />
        ) : (
          <LayersCheckIcon className="size-[18px] text-foreground" strokeWidth={1.8} />
        )}
        <TileLabel
          label="Save & close"
          meta={savingSessionClose ? "Saving…" : "saves, then closes"}
        />
      </Tile>

      {/* Live tile: the expander and the switch are siblings, not nested. The
          switch overlays the tile's top-right corner, so THIS wrapper is the
          positioning context — `SwitchPill` deliberately declares no position of
          its own (see `ui/switch-pill.tsx`). */}
      <div className="relative">
        <Tile
          onClick={() => live.setExpanded(true)}
          aria-expanded={live.expanded}
          aria-label="Live tabs settings"
          className="pr-9"
        >
          <RadioIcon
            className={
              live.enabled
                ? "size-[18px] text-emerald-600 dark:text-emerald-500"
                : "size-[18px] text-muted-foreground"
            }
            strokeWidth={1.8}
          />
          <TileLabel
            label="Live tabs"
            meta={
              !live.enabled
                ? "Off"
                : live.scanned
                  ? `On · ${live.sharedCount} window${live.sharedCount === 1 ? "" : "s"}`
                  : "On"
            }
            metaClassName={live.enabled ? "text-emerald-600 dark:text-emerald-500" : undefined}
          />
        </Tile>
        <SwitchPill
          checked={live.enabled}
          disabled={live.busy}
          onToggle={live.toggle}
          ariaLabel="Share this browser's open tabs"
          className="absolute right-2.5 top-2.5"
        />
      </div>

      <Tile onClick={onOpenApp} aria-label="Open the Bookmark AI web app">
        <ExternalLinkIcon className="size-[18px] text-foreground" strokeWidth={1.8} />
        <TileLabel label="Open app" meta={hostLabel(webUrl)} />
      </Tile>
    </div>
  );
}
