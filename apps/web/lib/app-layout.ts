/**
 * The signed-in app's responsive layout, as ONE pure decision.
 *
 * Three things compete for horizontal room on /app: the left sidebar (shadcn,
 * 16rem expanded / 3rem icon rail), the main pane, and the Ask AI dock on the
 * right (20–40% of the viewport, never under DOCK_MIN_PX). Deciding each of them
 * from the viewport alone — which is what the dock and the grid used to do — let
 * a 1136px window keep the full sidebar AND dock the chat AND draw three grid
 * columns, i.e. 155px cards with every label clipped.
 *
 * `resolveAppLayout` is the single arbiter. Its rules, in priority order:
 *  1. Mobile (< MOBILE_BREAKPOINT_PX): the sidebar is a sheet; the dock is a
 *     full-screen card below FULL_DOCK_BREAKPOINT_PX and a floating overlay above.
 *  2. Dock closed: the sidebar follows the user's toggle; nothing is forced.
 *  3. Dock open: docking (`side`) is preferred, but the main pane must keep at
 *     least MIN_CONTENT_PX. If the expanded sidebar leaves less, the sidebar is
 *     FORCED to the icon rail first. If the rail still leaves less, the dock
 *     becomes an `overlay` (floats over the content, reserves nothing) and the
 *     sidebar returns to the user's preference.
 *  4. If the user re-expands a forced-collapsed sidebar (`sidebarOverride`), that
 *     wins and the dock goes `overlay` — main-pane space always beats docking.
 *
 * The state-transition helpers below (`withViewportWidth` etc.) are the pure
 * half of the store in hooks/use-app-layout.ts; they own the override's
 * lifetime (set by the user's toggle, cleared when the dock closes or the
 * viewport grows enough that nothing is forced any more).
 *
 * Everything here is px arithmetic on numbers so it can be unit-tested without
 * a DOM — see app-layout.test.ts.
 */

/** Below this the sidebar is a sheet (shadcn `useIsMobile`). */
export const MOBILE_BREAKPOINT_PX = 768;
/** Below this an open dock takes the whole screen. */
export const FULL_DOCK_BREAKPOINT_PX = 640;
/** 16rem — SIDEBAR_WIDTH in components/ui/sidebar.tsx. */
export const SIDEBAR_EXPANDED_PX = 256;
/** 3rem — SIDEBAR_WIDTH_ICON in components/ui/sidebar.tsx. */
export const SIDEBAR_ICON_PX = 48;

/** Docked chat width as a fraction of the viewport, drag-resizable within bounds. */
export const DOCK_MIN_FRACTION = 0.2;
export const DOCK_MAX_FRACTION = 0.4;
export const DOCK_DEFAULT_FRACTION = 0.3;
/** Below this the chat is unusable — the floor of the docked width. */
export const DOCK_MIN_PX = 340;
/** The floating overlay is `min(26rem, 92vw)` wide. */
export const DOCK_OVERLAY_MAX_PX = 416;
export const DOCK_OVERLAY_FRACTION = 0.92;

/**
 * The least the main pane may be squeezed to while the dock is docked. Sized
 * for two comfortable grid columns: CONTENT_GUTTER_PX of padding plus two
 * CARD_MIN_PX cards and one GRID_GAP_PX gap must fit (pinned by a test).
 *
 * 620, not a rounder 640: a 1024 viewport (iPad landscape) minus the rail and
 * the 340 dock floor leaves 636, and docking there — two 286px columns, all
 * visible — beats a floating panel over half the grid. Docking holds down to
 * ~1008px; below that the dock floats.
 */
export const MIN_CONTENT_PX = 620;
/** The grid's `auto-fill` column minimum — every card is at least this wide. */
export const CARD_MIN_PX = 280;
/** `p-4` either side of the content shell. */
export const CONTENT_GUTTER_PX = 32;
/** `gap-4` between grid cells. */
export const GRID_GAP_PX = 16;

/**
 * The library grid's columns, from CONTAINER width rather than viewport
 * breakpoints: as many CARD_MIN_PX+ columns as fit, stretched to fill. Shared by
 * the live grid and both skeletons so they can never disagree.
 *
 * A LITERAL, not a template over CARD_MIN_PX: Tailwind's scanner reads source
 * text, and an interpolated class never generates CSS (the grid silently fell
 * back to one column). The test pins the two together instead.
 */
export const BOOKMARK_GRID_COLUMNS = "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]";

/**
 * What the layout assumes before the viewport is measured (SSR and the first
 * client render): a laptop, where the expanded sidebar + a default dock still
 * fit. The store corrects it on mount, before paint.
 */
export const DEFAULT_VIEWPORT_PX = 1280;

export type SidebarLayout = "expanded" | "icon" | "mobile";
export type DockLayout = "closed" | "side" | "overlay" | "full";

export interface AppLayoutInput {
  viewportWidth: number;
  dockOpen: boolean;
  /** Docked width as a fraction of the viewport (DOCK_MIN_FRACTION..DOCK_MAX_FRACTION). */
  dockFraction: number;
  /** The user's own sidebar toggle. */
  sidebarUserOpen: boolean;
  /** The user re-expanded the sidebar while it was forced to the rail (rule 4). */
  sidebarOverride: boolean;
}

export interface AppLayout {
  sidebar: SidebarLayout;
  dock: DockLayout;
  /** Width the dock occupies (side) or renders at (overlay/full); 0 when closed. */
  dockWidth: number;
  /** Width left for the main pane after the sidebar and a DOCKED chat. */
  contentWidth: number;
  /** The sidebar is on the rail because of the dock, not the user's toggle. */
  sidebarForced: boolean;
}

/** Docked width: the stored fraction of the viewport, never under the floor. */
export function dockedWidth(viewportWidth: number, fraction: number): number {
  return Math.max(DOCK_MIN_PX, Math.round(fraction * viewportWidth));
}

export function overlayWidth(viewportWidth: number): number {
  return Math.min(DOCK_OVERLAY_MAX_PX, Math.round(viewportWidth * DOCK_OVERLAY_FRACTION));
}

function sidebarWidth(sidebar: SidebarLayout): number {
  return sidebar === "expanded" ? SIDEBAR_EXPANDED_PX : sidebar === "icon" ? SIDEBAR_ICON_PX : 0;
}

export function resolveAppLayout(input: AppLayoutInput): AppLayout {
  const { viewportWidth, dockOpen, dockFraction, sidebarUserOpen, sidebarOverride } = input;

  // Rule 1 — mobile: the sidebar is a sheet, the dock floats or fills.
  if (viewportWidth < MOBILE_BREAKPOINT_PX) {
    const dock: DockLayout = !dockOpen
      ? "closed"
      : viewportWidth < FULL_DOCK_BREAKPOINT_PX
        ? "full"
        : "overlay";
    return {
      sidebar: "mobile",
      dock,
      dockWidth: dock === "full" ? viewportWidth : dock === "overlay" ? overlayWidth(viewportWidth) : 0,
      contentWidth: viewportWidth,
      sidebarForced: false,
    };
  }

  const userSidebar: SidebarLayout = sidebarUserOpen ? "expanded" : "icon";

  // Rule 2 — dock closed: nothing is forced.
  if (!dockOpen) {
    return {
      sidebar: userSidebar,
      dock: "closed",
      dockWidth: 0,
      contentWidth: viewportWidth - sidebarWidth(userSidebar),
      sidebarForced: false,
    };
  }

  const dockWidth = dockedWidth(viewportWidth, dockFraction);
  const contentBeside = (sidebar: SidebarLayout) =>
    viewportWidth - sidebarWidth(sidebar) - dockWidth;
  const docked = (sidebar: SidebarLayout, forced: boolean): AppLayout => ({
    sidebar,
    dock: "side",
    dockWidth,
    contentWidth: contentBeside(sidebar),
    sidebarForced: forced,
  });

  // Rule 3 — dock docked beside the sidebar the user chose, if the pane keeps its minimum.
  if (contentBeside(userSidebar) >= MIN_CONTENT_PX) return docked(userSidebar, false);

  // Rule 3, second step — collapse the sidebar to the rail before giving up on
  // docking. Rule 4 — unless the user explicitly re-expanded it.
  if (sidebarUserOpen && !sidebarOverride && contentBeside("icon") >= MIN_CONTENT_PX) {
    return docked("icon", true);
  }

  // Rule 3, last resort (and rule 4's outcome) — float the dock, reserve nothing.
  return {
    sidebar: userSidebar,
    dock: "overlay",
    dockWidth: overlayWidth(viewportWidth),
    contentWidth: viewportWidth - sidebarWidth(userSidebar),
    sidebarForced: false,
  };
}

/**
 * The widest the dock may be dragged at this viewport: the usual 40% cap, but
 * never so wide that the main pane beside the icon rail drops under
 * MIN_CONTENT_PX — past that point docking is impossible (the layout would flip
 * to overlay mid-drag and the handle would vanish under the pointer).
 */
export function maxDockFraction(viewportWidth: number): number {
  const roomFraction = (viewportWidth - SIDEBAR_ICON_PX - MIN_CONTENT_PX) / viewportWidth;
  return Math.max(DOCK_MIN_FRACTION, Math.min(DOCK_MAX_FRACTION, roomFraction));
}

export function clampDockFraction(fraction: number, viewportWidth: number): number {
  return Math.min(maxDockFraction(viewportWidth), Math.max(DOCK_MIN_FRACTION, fraction));
}

// ── Store state (the pure half of hooks/use-app-layout.ts) ────────────────────

export interface AppLayoutState {
  /** null until measured on the client — treated as DEFAULT_VIEWPORT_PX. */
  viewportWidth: number | null;
  /** Mirror of the dock's open flag (the URL is the source of truth) — kept so
   * the override can be retired the moment the dock closes. */
  dockOpen: boolean;
  dockFraction: number;
  sidebarUserOpen: boolean;
  sidebarOverride: boolean;
}

export const INITIAL_APP_LAYOUT_STATE: AppLayoutState = {
  viewportWidth: null,
  dockOpen: false,
  dockFraction: DOCK_DEFAULT_FRACTION,
  sidebarUserOpen: true,
  sidebarOverride: false,
};

/** Resolve a store state, optionally with a fresher `dockOpen` than the mirror. */
export function layoutFromState(state: AppLayoutState, dockOpen = state.dockOpen): AppLayout {
  return resolveAppLayout({
    viewportWidth: state.viewportWidth ?? DEFAULT_VIEWPORT_PX,
    dockOpen,
    dockFraction: state.dockFraction,
    sidebarUserOpen: state.sidebarUserOpen,
    sidebarOverride: state.sidebarOverride,
  });
}

/**
 * Retire the override once nothing would be forced without it — the dock
 * closed, the viewport grew enough for the expanded sidebar to fit beside the
 * dock, or it shrank so far that even the rail can't keep the pane (overlay
 * anyway). Keeping a stale override would push the dock to overlay the next
 * time the rail band is re-entered, against rule 3.
 */
function settleOverride(state: AppLayoutState): AppLayoutState {
  if (!state.sidebarOverride) return state;
  const unforced = layoutFromState({ ...state, sidebarOverride: false });
  return unforced.sidebarForced ? state : { ...state, sidebarOverride: false };
}

export function withViewportWidth(state: AppLayoutState, viewportWidth: number): AppLayoutState {
  if (state.viewportWidth === viewportWidth) return state;
  return settleOverride({ ...state, viewportWidth });
}

export function withDockOpen(state: AppLayoutState, dockOpen: boolean): AppLayoutState {
  if (state.dockOpen === dockOpen) return state;
  return settleOverride({ ...state, dockOpen });
}

export function withDockFraction(state: AppLayoutState, fraction: number): AppLayoutState {
  const next = clampDockFraction(fraction, state.viewportWidth ?? DEFAULT_VIEWPORT_PX);
  if (state.dockFraction === next) return state;
  return settleOverride({ ...state, dockFraction: next });
}

/**
 * The user's own toggle. Opening while the rail is forced is rule 4's override;
 * closing always retires it (the user asked for the rail, nothing is forced).
 */
export function withSidebarOpen(state: AppLayoutState, open: boolean): AppLayoutState {
  if (!open) {
    if (!state.sidebarUserOpen && !state.sidebarOverride) return state;
    return { ...state, sidebarUserOpen: false, sidebarOverride: false };
  }
  const forced = layoutFromState({ ...state, sidebarUserOpen: true, sidebarOverride: false })
    .sidebarForced;
  if (state.sidebarUserOpen && state.sidebarOverride === forced) return state;
  return { ...state, sidebarUserOpen: true, sidebarOverride: forced };
}
