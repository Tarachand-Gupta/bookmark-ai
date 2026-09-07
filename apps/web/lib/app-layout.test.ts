import { describe, expect, it } from "vitest";
import {
  BOOKMARK_GRID_COLUMNS,
  CARD_MIN_PX,
  CONTENT_GUTTER_PX,
  DEFAULT_VIEWPORT_PX,
  DOCK_MAX_FRACTION,
  DOCK_MIN_FRACTION,
  DOCK_MIN_PX,
  GRID_GAP_PX,
  INITIAL_APP_LAYOUT_STATE,
  MIN_CONTENT_PX,
  SIDEBAR_EXPANDED_PX,
  SIDEBAR_ICON_PX,
  clampDockFraction,
  dockedWidth,
  layoutFromState,
  maxDockFraction,
  overlayWidth,
  resolveAppLayout,
  withDockFraction,
  withDockOpen,
  withSidebarOpen,
  withViewportWidth,
  type AppLayoutInput,
  type AppLayoutState,
} from "./app-layout";

/**
 * The layout arbiter's decision table (see the module comment for the rules).
 * Every case names the viewport the owner actually looked at, so a regression
 * reads as "1136 with the dock open drew three columns again".
 */

const base: AppLayoutInput = {
  viewportWidth: 1440,
  dockOpen: true,
  dockFraction: 0.3,
  sidebarUserOpen: true,
  sidebarOverride: false,
};

const at = (overrides: Partial<AppLayoutInput>) => resolveAppLayout({ ...base, ...overrides });

describe("constants", () => {
  it("keeps two cards + gutters inside the minimum content width", () => {
    expect(MIN_CONTENT_PX - CONTENT_GUTTER_PX).toBeGreaterThanOrEqual(2 * CARD_MIN_PX + GRID_GAP_PX);
  });

  it("pins the (literal) grid class to the card minimum the resolver reasons about", () => {
    expect(BOOKMARK_GRID_COLUMNS).toBe(`grid-cols-[repeat(auto-fill,minmax(${CARD_MIN_PX}px,1fr))]`);
  });

  it("assumes a viewport where the expanded sidebar and a default dock both fit", () => {
    const layout = at({ viewportWidth: DEFAULT_VIEWPORT_PX });
    expect(layout).toMatchObject({ sidebar: "expanded", dock: "side", sidebarForced: false });
  });
});

describe("rule 1 — mobile", () => {
  it("fills the screen with the dock below 640", () => {
    expect(at({ viewportWidth: 390 })).toEqual({
      sidebar: "mobile",
      dock: "full",
      dockWidth: 390,
      contentWidth: 390,
      sidebarForced: false,
    });
  });

  it("floats the dock between 640 and 768", () => {
    expect(at({ viewportWidth: 700 })).toMatchObject({
      sidebar: "mobile",
      dock: "overlay",
      dockWidth: 416,
      contentWidth: 700,
    });
  });

  it("caps the overlay at 26rem, or 92vw where that is narrower", () => {
    expect(at({ viewportWidth: 645 }).dockWidth).toBe(416);
    expect(overlayWidth(400)).toBe(368); // the CSS `min(26rem, 92vw)`, mirrored
  });

  it("keeps the sheet sidebar with the dock closed", () => {
    expect(at({ viewportWidth: 700, dockOpen: false })).toEqual({
      sidebar: "mobile",
      dock: "closed",
      dockWidth: 0,
      contentWidth: 700,
      sidebarForced: false,
    });
  });
});

describe("rule 2 — dock closed follows the user's toggle", () => {
  it("expanded", () => {
    expect(at({ viewportWidth: 1136, dockOpen: false })).toEqual({
      sidebar: "expanded",
      dock: "closed",
      dockWidth: 0,
      contentWidth: 1136 - SIDEBAR_EXPANDED_PX,
      sidebarForced: false,
    });
  });

  it("icon rail", () => {
    expect(at({ viewportWidth: 1136, dockOpen: false, sidebarUserOpen: false })).toMatchObject({
      sidebar: "icon",
      dock: "closed",
      contentWidth: 1136 - SIDEBAR_ICON_PX,
    });
  });

  it("ignores a stale override", () => {
    expect(at({ viewportWidth: 900, dockOpen: false, sidebarOverride: true }).sidebar).toBe(
      "expanded",
    );
  });
});

describe("rule 3 — docked beside the sidebar the user chose", () => {
  it("1440: expanded sidebar + 30% dock leave 752 for content", () => {
    expect(at({ viewportWidth: 1440 })).toEqual({
      sidebar: "expanded",
      dock: "side",
      dockWidth: 432,
      contentWidth: 752,
      sidebarForced: false,
    });
  });

  it("1920: a 40% dock still docks beside the expanded sidebar", () => {
    expect(at({ viewportWidth: 1920, dockFraction: 0.4 })).toMatchObject({
      sidebar: "expanded",
      dock: "side",
      dockWidth: 768,
      contentWidth: 1920 - 256 - 768,
    });
  });

  it("never docks narrower than the floor", () => {
    expect(at({ viewportWidth: 1100, dockFraction: 0.2 }).dockWidth).toBe(DOCK_MIN_PX);
  });

  it("1136: the expanded sidebar would leave 539, so the rail is forced", () => {
    expect(at({ viewportWidth: 1136 })).toEqual({
      sidebar: "icon",
      dock: "side",
      dockWidth: 341,
      contentWidth: 1136 - SIDEBAR_ICON_PX - 341,
      sidebarForced: true,
    });
  });

  it("forces the rail exactly when the expanded pane drops under the minimum", () => {
    let transitions = 0;
    let previous: boolean | null = null;
    for (let w = 1100; w <= 1400; w++) {
      const layout = at({ viewportWidth: w });
      const expandedPane = w - SIDEBAR_EXPANDED_PX - dockedWidth(w, 0.3);
      expect(layout.sidebarForced).toBe(expandedPane < MIN_CONTENT_PX);
      if (previous !== null && previous !== layout.sidebarForced) transitions++;
      previous = layout.sidebarForced;
    }
    expect(transitions).toBe(1); // one clean boundary, no flapping
  });

  it("1024 (iPad landscape) still docks beside the rail", () => {
    expect(at({ viewportWidth: 1024 })).toMatchObject({
      sidebar: "icon",
      dock: "side",
      dockWidth: DOCK_MIN_PX,
      contentWidth: 1024 - SIDEBAR_ICON_PX - DOCK_MIN_PX,
      sidebarForced: true,
    });
  });

  it("900: even the rail leaves 512, so the dock floats and the sidebar is the user's", () => {
    expect(at({ viewportWidth: 900 })).toEqual({
      sidebar: "expanded",
      dock: "overlay",
      dockWidth: 416,
      contentWidth: 900 - SIDEBAR_EXPANDED_PX,
      sidebarForced: false,
    });
  });

  it("a user-collapsed sidebar is never reported as forced", () => {
    expect(at({ viewportWidth: 1136, sidebarUserOpen: false })).toMatchObject({
      sidebar: "icon",
      dock: "side",
      sidebarForced: false,
    });
    expect(at({ viewportWidth: 900, sidebarUserOpen: false })).toMatchObject({
      sidebar: "icon",
      dock: "overlay",
      sidebarForced: false,
    });
  });

  it("the docked pane is never narrower than the minimum", () => {
    for (let w = 768; w <= 2560; w += 7) {
      for (const f of [0.2, 0.3, 0.4]) {
        for (const open of [true, false]) {
          const layout = at({ viewportWidth: w, dockFraction: f, sidebarUserOpen: open });
          if (layout.dock === "side") expect(layout.contentWidth).toBeGreaterThanOrEqual(MIN_CONTENT_PX);
        }
      }
    }
  });
});

describe("rule 4 — the user's re-expand wins over docking", () => {
  it("1136 with the override: expanded sidebar, floating dock", () => {
    expect(at({ viewportWidth: 1136, sidebarOverride: true })).toEqual({
      sidebar: "expanded",
      dock: "overlay",
      dockWidth: 416,
      contentWidth: 1136 - SIDEBAR_EXPANDED_PX,
      sidebarForced: false,
    });
  });

  it("is moot where the expanded sidebar fits anyway", () => {
    expect(at({ viewportWidth: 1440, sidebarOverride: true })).toMatchObject({
      sidebar: "expanded",
      dock: "side",
    });
  });
});

describe("drag bounds", () => {
  it("caps the fraction so the rail + minimum pane always fit", () => {
    const room = (w: number) => (w - SIDEBAR_ICON_PX - MIN_CONTENT_PX) / w;
    expect(maxDockFraction(1280)).toBe(DOCK_MAX_FRACTION);
    expect(maxDockFraction(1136)).toBeCloseTo(Math.min(DOCK_MAX_FRACTION, room(1136)), 6);
    // Narrow enough that the room, not the 40% ceiling, is the binding cap.
    expect(room(1000)).toBeLessThan(DOCK_MAX_FRACTION);
    expect(maxDockFraction(1000)).toBeCloseTo(room(1000), 6);
  });

  it("never reports a cap under the minimum fraction", () => {
    expect(maxDockFraction(700)).toBe(DOCK_MIN_FRACTION);
  });

  it("clamps both ends", () => {
    expect(clampDockFraction(0.05, 1440)).toBe(DOCK_MIN_FRACTION);
    expect(clampDockFraction(0.9, 1440)).toBe(DOCK_MAX_FRACTION);
    expect(clampDockFraction(0.35, 1136)).toBeCloseTo(0.35, 6);
    expect(clampDockFraction(0.4, 1136)).toBeCloseTo(maxDockFraction(1136), 6);
  });
});

describe("store transitions", () => {
  const measured = (viewportWidth: number, extra: Partial<AppLayoutState> = {}): AppLayoutState => ({
    ...INITIAL_APP_LAYOUT_STATE,
    viewportWidth,
    dockOpen: true,
    ...extra,
  });

  it("resolves the unmeasured state as the default viewport", () => {
    expect(layoutFromState(INITIAL_APP_LAYOUT_STATE)).toEqual(
      resolveAppLayout({ ...base, viewportWidth: DEFAULT_VIEWPORT_PX, dockOpen: false }),
    );
  });

  it("re-expanding a forced sidebar sets the override; collapsing clears it", () => {
    const forced = measured(1136);
    expect(layoutFromState(forced).sidebarForced).toBe(true);
    const reopened = withSidebarOpen(forced, true);
    expect(reopened.sidebarOverride).toBe(true);
    expect(layoutFromState(reopened)).toMatchObject({ sidebar: "expanded", dock: "overlay" });
    const collapsed = withSidebarOpen(reopened, false);
    expect(collapsed).toMatchObject({ sidebarUserOpen: false, sidebarOverride: false });
    expect(layoutFromState(collapsed)).toMatchObject({ sidebar: "icon", dock: "side" });
  });

  it("re-expanding where nothing is forced sets no override", () => {
    const state = withSidebarOpen(measured(1440, { sidebarUserOpen: false }), true);
    expect(state).toMatchObject({ sidebarUserOpen: true, sidebarOverride: false });
  });

  it("closing the dock retires the override", () => {
    const overridden = withSidebarOpen(measured(1136), true);
    const closed = withDockOpen(overridden, false);
    expect(closed.sidebarOverride).toBe(false);
    // …so re-opening at the same width forces the rail again (rule 3, not a stale rule 4).
    expect(layoutFromState(withDockOpen(closed, true))).toMatchObject({
      sidebar: "icon",
      sidebarForced: true,
    });
  });

  it("growing the viewport until the expanded sidebar fits retires the override", () => {
    const overridden = withSidebarOpen(measured(1136), true);
    expect(withViewportWidth(overridden, 1200).sidebarOverride).toBe(true); // still forced-band
    const grown = withViewportWidth(overridden, 1440);
    expect(grown.sidebarOverride).toBe(false);
    expect(layoutFromState(grown)).toMatchObject({ sidebar: "expanded", dock: "side" });
  });

  it("shrinking past the rail band retires the override too", () => {
    const overridden = withSidebarOpen(measured(1136), true);
    const shrunk = withViewportWidth(overridden, 900);
    expect(shrunk.sidebarOverride).toBe(false);
    expect(layoutFromState(shrunk)).toMatchObject({ sidebar: "expanded", dock: "overlay" });
    // Back into the band → forced again, no stale override.
    expect(layoutFromState(withViewportWidth(shrunk, 1136))).toMatchObject({
      sidebar: "icon",
      sidebarForced: true,
    });
  });

  it("a wider dock can force the rail; the drag is clamped to keep the pane", () => {
    const state = measured(1300); // 1300 − 256 − 390 = 654 fits at 30%
    expect(layoutFromState(state)).toMatchObject({ sidebar: "expanded", dock: "side" });
    const wider = withDockFraction(state, 0.36); // 468 → 576 beside expanded → rail
    expect(layoutFromState(wider)).toMatchObject({ sidebar: "icon", sidebarForced: true });
    const clamped = withDockFraction(state, 0.9);
    expect(clamped.dockFraction).toBe(DOCK_MAX_FRACTION);
    expect(layoutFromState(clamped).contentWidth).toBeGreaterThanOrEqual(MIN_CONTENT_PX);
  });

  it("returns the same object when nothing changes", () => {
    const state = measured(1440); // nothing forced here, so re-opening is a no-op
    expect(withViewportWidth(state, 1440)).toBe(state);
    expect(withDockOpen(state, true)).toBe(state);
    expect(withDockFraction(state, 0.3)).toBe(state);
    expect(withSidebarOpen(state, true)).toBe(state);
  });
});
