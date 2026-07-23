"use client";

import { useRef } from "react";
import { Cubes } from "./cubes";

/**
 * Places the interactive cube lattice as the marketing page's background
 * texture — a band of dashed squares across the top of the page. It replaced
 * the old graph-paper grid that <Backdrop /> used to draw.
 *
 * It's `fixed` at the viewport's top-left with a 58px pitch, so the lattice
 * stays put as the page scrolls (like the ambient blooms behind it).
 *
 * Layering: z-0 (same plane as <Backdrop />, painted just after it) and
 * `pointer-events-none`, so it never intercepts a click meant for a link or
 * button — the hover tilt is driven off document pointer coordinates instead.
 * Content lives at z-10 and always stays on top.
 */

// Lattice repeat pitch, px.
const CELL = 58;
// 32 columns ≈ 1856px covers desktop widths; the edge mask fades whatever the
// viewport doesn't reach. 10 rows ≈ 580px spans the hero's headline band only —
// deliberately not the whole page, to keep the cube (and tween) count bounded.
const COLS = 32;
const ROWS = 10;
const BAND_HEIGHT = ROWS * CELL;

export function CubesField() {
  // Normal-flow marker at the document's top band. The scene is `fixed` and so
  // never leaves the viewport; observing THIS tells the effect when the hero
  // band has scrolled away, so it can idle.
  const sentinelRef = useRef<HTMLDivElement>(null);

  return (
    <div aria-hidden className="pointer-events-none">
      <div
        ref={sentinelRef}
        className="absolute left-0 top-0 w-px"
        style={{ height: BAND_HEIGHT }}
      />
      <div
        className="fixed left-0 top-0 z-0 overflow-hidden text-foreground"
        style={{
          width: "100vw",
          height: BAND_HEIGHT,
          // Fade toward the sides and bottom so the lattice never reads as a
          // hard rectangle — mirrors the grid's own radial mask.
          maskImage:
            "radial-gradient(115% 100% at 50% 0%, black 32%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(115% 100% at 50% 0%, black 32%, transparent 78%)",
        }}
      >
        <Cubes
          cols={COLS}
          rows={ROWS}
          cell={CELL}
          activeSentinelRef={sentinelRef}
        />
      </div>
    </div>
  );
}
