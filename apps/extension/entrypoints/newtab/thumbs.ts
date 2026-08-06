import { presetThumbnailNames, type NewTabTemplateConfig } from "@bookmark-ai/types";

/**
 * Template thumbnails (docs/features/newtab-canvas.md §4.7/§5.5). A thumbnail
 * is a NAMED preset (rendered as a small static SVG tile) or a custom data
 * URL the agent set — validated before use: inline SVG ≤4k or PNG ≤16k,
 * never data:text/html, never an external URL. Unknown/garbage falls back to
 * the "favorites" tile.
 */

const SVG_MAX = 4_096;
const PNG_MAX = 16_384;

const TILE_GLYPHS: Record<string, string> = {
  favorites: "★",
  recent: "🕘",
  continue: "▶",
  "working-on": "◎",
  "most-used": "↗",
  "time-spent": "◷",
};

export type Thumbnail =
  | { kind: "data-url"; url: string }
  | { kind: "tile"; name: string; glyph: string };

export function resolveThumbnail(config: NewTabTemplateConfig | undefined): Thumbnail {
  const value = config?.thumbnail ?? "favorites";
  const named = (presetThumbnailNames as readonly string[]).includes(value);
  if (named) return { kind: "tile", name: value, glyph: TILE_GLYPHS[value] ?? "★" };

  if (value.startsWith("data:image/svg+xml") && value.length <= SVG_MAX) {
    return { kind: "data-url", url: value };
  }
  if (value.startsWith("data:image/png") && value.length <= PNG_MAX) {
    return { kind: "data-url", url: value };
  }
  return { kind: "tile", name: "favorites", glyph: TILE_GLYPHS.favorites! };
}
