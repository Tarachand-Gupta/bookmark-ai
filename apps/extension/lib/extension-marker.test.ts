import { describe, expect, it } from "vitest";
import {
  EXTENSION_MARKER_ATTR,
  EXTENSION_MARKER_VALUE,
  markExtensionPresent,
  type MarkerRoot,
} from "./extension-marker";

/** Stand-in for `document.documentElement` — the helper only needs get/set. */
function fakeRoot(initial: Record<string, string> = {}): MarkerRoot & {
  attrs: Record<string, string>;
  writes: number;
} {
  const attrs = { ...initial };
  let writes = 0;
  return {
    attrs,
    get writes() {
      return writes;
    },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = value;
      writes += 1;
    },
  };
}

describe("markExtensionPresent", () => {
  it("stamps the marker attribute on the document root", () => {
    const root = fakeRoot();
    expect(markExtensionPresent(root)).toBe(true);
    expect(root.attrs[EXTENSION_MARKER_ATTR]).toBe(EXTENSION_MARKER_VALUE);
  });

  it("is idempotent — a second run does not rewrite the attribute", () => {
    const root = fakeRoot();
    markExtensionPresent(root);
    expect(markExtensionPresent(root)).toBe(false);
    expect(root.writes).toBe(1);
  });

  it("re-stamps when something stripped the attribute", () => {
    const root = fakeRoot();
    markExtensionPresent(root);
    delete root.attrs[EXTENSION_MARKER_ATTR];
    expect(markExtensionPresent(root)).toBe(true);
    expect(root.attrs[EXTENSION_MARKER_ATTR]).toBe(EXTENSION_MARKER_VALUE);
  });

  it("overwrites an unexpected value", () => {
    const root = fakeRoot({ [EXTENSION_MARKER_ATTR]: "0" });
    expect(markExtensionPresent(root)).toBe(true);
    expect(root.attrs[EXTENSION_MARKER_ATTR]).toBe(EXTENSION_MARKER_VALUE);
  });

  it("tolerates a missing root (no document yet)", () => {
    expect(markExtensionPresent(null)).toBe(false);
    expect(markExtensionPresent(undefined)).toBe(false);
  });

  /** The web app hard-codes this string in apps/web/lib/extension-detect.ts —
   * a rename on either side silently kills Firefox/Safari detection. */
  it("keeps the attribute contract the web app reads", () => {
    expect(EXTENSION_MARKER_ATTR).toBe("data-bookmark-ai-extension");
    expect(EXTENSION_MARKER_VALUE).toBe("1");
  });
});

// The origin lists the marker's `matches` come from are pinned in
// lib/app-origins.test.ts (mode-aware: production = prod origins only).
