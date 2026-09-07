/**
 * The ONE content-width rule for every reading surface (Home, Library list,
 * Sessions, Search results, Ask AI thread + composer, Settings).
 *
 * Phones keep their edge-to-edge layout untouched: below WIDE_BREAKPOINT the
 * inset is 0 and the grid stays at two columns, so every phone screen renders
 * pixel-identical to before. At tablet widths — an iPad in either orientation,
 * but NOT an iPad Split View pane squeezed to phone width, which is why this
 * keys off the WINDOW width rather than `Platform.isPad` — reading surfaces are
 * capped at CONTENT_MAX_WIDTH and centered. `inset` is the extra horizontal
 * padding per side that does the centering, applied on top of the 20pt gutters
 * the components already carry (so a 760pt column reads as 720pt of text, in
 * the readable-width range iOS itself uses).
 *
 * The Library GRID is the one surface that does the opposite: it keeps the
 * full width and adds columns, because a wall of cards is what a wide screen
 * is FOR — see `gridColumns`.
 */
export const WIDE_BREAKPOINT = 600;
/** Column width INCLUDING the two 20pt gutters the screens already carry. */
export const CONTENT_MAX_WIDTH = 760;
/** Tablet landscape (11" iPad Pro/Air landscape = 1180–1194pt; 13" = 1376). */
export const GRID_FOUR_BREAKPOINT = 1100;

export interface ContentLayout {
  /** Tablet-class width (≥ WIDE_BREAKPOINT); false for every phone width. */
  wide: boolean;
  /** Extra horizontal padding PER SIDE that centers the column; 0 on phones. */
  inset: number;
  /** What's left for content after the inset — the window width on phones. */
  columnWidth: number;
  /** Library grid: 2 (phone) · 3 (tablet portrait) · 4 (tablet landscape). */
  gridColumns: 2 | 3 | 4;
}

export function contentLayout(windowWidth: number): ContentLayout {
  // A zero/NaN width (a window not yet measured) must never yield a negative
  // inset or a NaN padding — it just behaves like a phone until it's known.
  const width = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 0;
  const wide = width >= WIDE_BREAKPOINT;
  const inset = wide ? Math.max(0, Math.floor((width - CONTENT_MAX_WIDTH) / 2)) : 0;
  const gridColumns: ContentLayout["gridColumns"] = !wide
    ? 2
    : width >= GRID_FOUR_BREAKPOINT
      ? 4
      : 3;
  return { wide, inset, columnWidth: width - inset * 2, gridColumns };
}
