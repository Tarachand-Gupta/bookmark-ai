/**
 * The popup follows the OS appearance through a `.dark` class that main.tsx
 * mirrors from `matchMedia`. On SAFARI that alone is not enough: WebKit renders
 * an extension popover in the light appearance — and reports
 * `prefers-color-scheme: dark` as false INSIDE it — until the document declares
 * that it supports dark, i.e. `color-scheme: light dark`. Missing that, the
 * Safari popup stayed light on a dark Mac while Chrome/Firefox were fine.
 *
 * These read the two source files rather than a build, so they fail the moment
 * the declaration is edited out, in every browser target at once.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

const html = read("index.html");
const mainTsx = read("main.tsx");
const css = read("../../assets/tailwind.css");

/** The `:root { … }` block that carries the light palette. */
const rootBlock = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const darkBlock = /(?:^|\n)\.dark\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

describe("popup: declares support for the dark appearance (Safari popover rule)", () => {
  it("carries the color-scheme meta in <head>, before the stylesheet loads", () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
    expect(head).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/);
  });

  it("declares color-scheme: light dark on :root in the popup stylesheet", () => {
    expect(rootBlock).toMatch(/color-scheme:\s*light dark;/);
  });

  it("does NOT pin the UA appearance to the .dark class (that paints a light first frame)", () => {
    // main.tsx adds the class after first paint, so `.dark { color-scheme: dark }`
    // + `:root:not(.dark) { color-scheme: light }` would flash white on a dark Mac.
    expect(darkBlock).not.toMatch(/color-scheme/);
    expect(css).not.toMatch(/:root:not\(\.dark\)/);
  });
});

describe("popup: the class mechanism and the light palette are untouched", () => {
  it("still gates every dark utility on the .dark class", () => {
    expect(css).toContain("@custom-variant dark (&:is(.dark *))");
    expect(mainTsx).toContain('window.matchMedia("(prefers-color-scheme: dark)")');
    expect(mainTsx).toContain('document.documentElement.classList.toggle("dark", dark)');
  });

  it("keeps :root on the light tokens, so no .dark class = light popup", () => {
    expect(rootBlock).toMatch(/--background:\s*oklch\(1 0 0\);/);
    expect(rootBlock).toMatch(/--foreground:\s*oklch\(0\.145 0 0\);/);
    // …and the dark block is the inverse pair, applied only under the class.
    expect(darkBlock).toMatch(/--background:\s*oklch\(0\.145 0 0\);/);
    expect(darkBlock).toMatch(/--foreground:\s*oklch\(0\.985 0 0\);/);
  });
});
