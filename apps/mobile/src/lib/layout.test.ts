import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTENT_MAX_WIDTH,
  contentLayout,
  GRID_FOUR_BREAKPOINT,
  WIDE_BREAKPOINT,
} from "./layout";

// Real device widths in points, so a breakpoint nudge fails against hardware
// people actually hold rather than against round numbers.
const PHONES = {
  "iPhone SE": 375,
  "iPhone 15": 393,
  "iPhone 17": 402,
  "iPhone 17 Pro Max": 440,
};
const TABLETS_PORTRAIT = {
  "iPad mini": 744,
  "iPad 10th gen": 820,
  'iPad Pro 11"': 834,
  'iPad Pro 13" (M4)': 1032,
};
const TABLETS_LANDSCAPE = {
  "iPad mini": 1133,
  'iPad Pro 11"': 1194,
  'iPad Pro 13" (M4)': 1376,
};

describe("contentLayout on phones", () => {
  for (const [name, width] of Object.entries(PHONES)) {
    it(`${name} (${width}pt) keeps the edge-to-edge phone layout`, () => {
      const layout = contentLayout(width);
      assert.equal(layout.wide, false);
      assert.equal(layout.inset, 0, "no extra padding — phones must stay pixel-identical");
      assert.equal(layout.columnWidth, width);
      assert.equal(layout.gridColumns, 2);
    });
  }

  it("treats an iPad Split View pane at phone width as a phone", () => {
    // 13" iPad portrait split 50/50 ≈ 507pt; the narrow third ≈ 320pt.
    for (const width of [320, 375, 507]) {
      const layout = contentLayout(width);
      assert.equal(layout.wide, false, `${width}pt`);
      assert.equal(layout.inset, 0, `${width}pt`);
      assert.equal(layout.gridColumns, 2, `${width}pt`);
    }
  });

  it("is safe before the window has been measured", () => {
    for (const width of [0, -1, Number.NaN]) {
      const layout = contentLayout(width);
      assert.equal(layout.wide, false);
      assert.equal(layout.inset, 0);
      assert.equal(layout.columnWidth, 0);
      assert.equal(layout.gridColumns, 2);
    }
  });
});

describe("contentLayout on tablets", () => {
  it("switches at the breakpoint exactly", () => {
    assert.equal(contentLayout(WIDE_BREAKPOINT - 1).wide, false);
    assert.equal(contentLayout(WIDE_BREAKPOINT).wide, true);
  });

  for (const [name, width] of Object.entries(TABLETS_PORTRAIT)) {
    it(`${name} portrait (${width}pt) centers a capped column with 3 grid columns`, () => {
      const layout = contentLayout(width);
      assert.equal(layout.wide, true);
      assert.equal(layout.gridColumns, 3);
      assert.ok(layout.columnWidth <= Math.max(CONTENT_MAX_WIDTH, width));
      // The inset is symmetric and never pushes the column below the cap when
      // the window is wider than the cap.
      if (width >= CONTENT_MAX_WIDTH) {
        assert.ok(layout.columnWidth >= CONTENT_MAX_WIDTH);
        assert.ok(layout.columnWidth <= CONTENT_MAX_WIDTH + 1, "odd widths round down the inset");
      } else {
        assert.equal(layout.inset, 0, "narrower than the cap → nothing to center");
        assert.equal(layout.columnWidth, width);
      }
      assert.equal(layout.columnWidth, width - layout.inset * 2);
    });
  }

  for (const [name, width] of Object.entries(TABLETS_LANDSCAPE)) {
    it(`${name} landscape (${width}pt) uses 4 grid columns and the same column cap`, () => {
      const layout = contentLayout(width);
      assert.equal(layout.wide, true);
      assert.equal(layout.gridColumns, 4);
      // Odd widths (iPad mini landscape is 1133pt) floor the inset, so the
      // column lands on the cap or one point over — never under, never a half.
      assert.equal(layout.inset, Math.floor((width - CONTENT_MAX_WIDTH) / 2));
      assert.ok(Number.isInteger(layout.inset));
      assert.ok(layout.columnWidth >= CONTENT_MAX_WIDTH);
      assert.ok(layout.columnWidth <= CONTENT_MAX_WIDTH + 1);
    });
  }

  it("goes to four columns at the landscape breakpoint exactly", () => {
    assert.equal(contentLayout(GRID_FOUR_BREAKPOINT - 1).gridColumns, 3);
    assert.equal(contentLayout(GRID_FOUR_BREAKPOINT).gridColumns, 4);
  });

  it('13" iPad Pro: 136pt per side portrait, 308pt landscape', () => {
    assert.equal(contentLayout(1032).inset, 136);
    assert.equal(contentLayout(1376).inset, 308);
  });
});
