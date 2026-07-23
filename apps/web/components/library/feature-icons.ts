import { Bookmark, Layers, Radio, ScanSearch, Sparkles } from "lucide-react";

/**
 * Single source of truth for the icon that represents each product feature,
 * so every surface (sidebar, product tour, marketing feature cards) shows the
 * SAME glyph for a given feature. The marketing cards are aligned to this exact
 * set — change a glyph here and update the marketing card to match.
 *
 * `live` and `sessions` deliberately differ: Live sessions = Radio (with an
 * emerald pulse dot the sidebar overlays), Saved sessions = Layers.
 */
export const FEATURE_ICONS = {
  /** Bookmarks / "All bookmarks". */
  bookmarks: Bookmark,
  /** AI categories & tags / "AI setup". */
  ai: Sparkles,
  /** Search by meaning (hybrid keyword + semantic). */
  search: ScanSearch,
  /** Live sessions / Live tabs (open tabs mirrored across devices). */
  live: Radio,
  /** Saved sessions (a whole window snapshotted). */
  sessions: Layers,
} as const satisfies Record<string, React.ElementType>;

export type FeatureId = keyof typeof FEATURE_ICONS;
