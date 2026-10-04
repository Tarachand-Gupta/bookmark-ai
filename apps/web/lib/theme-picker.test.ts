import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PRESET_NAMES, themeTokens } from "./theme-picker/catalog";
import { themeCss } from "./theme-picker/css";
import { themeBootstrapScript } from "./theme-picker/bootstrap";
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_PREFERENCE_KEY,
} from "./theme-picker/preferences";

describe("web named theme preferences", () => {
  it("accepts only v2 named presets, discarding legacy, hostile and stored CSS values", () => {
    const valid = { version: 2, preset: "bubblegum" };
    expect(parseThemePreference(JSON.stringify({ ...valid, css: "body{display:none}" }))).toEqual(
      valid,
    );
    for (const raw of [
      null,
      "broken",
      "[]",
      "null",
      JSON.stringify({ version: 1, base: "mist", accent: "yellow", radius: "none" }),
      ...["constructor", "__proto__", "</style><script>bad()", "custom"].map((preset) =>
        JSON.stringify({ ...valid, preset }),
      ),
    ])
      expect(parseThemePreference(raw)).toEqual(DEFAULT_THEME_PREFERENCE);
  });
  it("keeps blocked storage optional and resets only its own key", () => {
    const blocked = {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
      removeItem: () => {
        throw Error("blocked");
      },
    };
    expect(readThemePreference(blocked)).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(saveThemePreference(blocked, DEFAULT_THEME_PREFERENCE)).toBe(false);
    const values = new Map([
      ["theme", "dark"],
      ["unrelated", "keep"],
    ]);
    const storage = {
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    expect(saveThemePreference(storage, { version: 2, preset: "claude" })).toBe(true);
    expect(values.has(THEME_PREFERENCE_KEY)).toBe(true);
    expect(saveThemePreference(storage, DEFAULT_THEME_PREFERENCE)).toBe(true);
    expect(Object.fromEntries(values)).toEqual({ theme: "dark", unrelated: "keep" });
  });
  it("restores every exact shared baseline token in both modes", () => {
    const shared = readFileSync(
      new URL("../../../packages/ui/src/theme.css", import.meta.url),
      "utf8",
    );
    const blocks = {
      light: shared.match(/:root\s*\{([^}]+)\}/)![1],
      dark: shared.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/)![1],
    };
    for (const mode of ["light", "dark"] as const)
      for (const match of blocks[mode].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g))
        expect(themeTokens("default", mode)[match[1]]).toBe(match[2]);
    expect(themeTokens("default", "dark")["sidebar-primary"]).toBe("oklch(0.488 0.243 264.376)");
  });
  it("replaces complete maps for all 43 presets without overriding brand typography or spacing", () => {
    expect(PRESET_NAMES).toHaveLength(43);
    const keys = Object.keys(themeTokens("default", "light")).sort();
    for (const name of PRESET_NAMES)
      for (const mode of ["light", "dark"] as const) {
        const tokens = themeTokens(name, mode);
        expect(Object.keys(tokens).sort()).toEqual(keys);
        expect(
          Object.values(tokens).every((value) => typeof value === "string" && value.length > 0),
        ).toBe(true);
        expect(tokens).not.toHaveProperty("font-sans");
        expect(tokens).not.toHaveProperty("spacing");
        expect(tokens).not.toHaveProperty("letter-spacing");
      }
    expect(themeTokens("neo-brutalism", "light")["picker-radius-xl"]).toBe("0px");
    expect(themeTokens("bubblegum", "light")["picker-shadow-md"]).toBe(
      "3px 3px 0px 0px hsl(325.78 58.18% 56.86% / 1.00), 3px 2px 4px -1px hsl(325.78 58.18% 56.86% / 1.00)",
    );
    expect(themeTokens("default", "light")["picker-shadow-sm"]).toBe(
      "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    );
  });
  it("executes prepaint restore matching client CSS exactly, including safe fallback", () => {
    for (const input of [
      { version: 2, preset: "catppuccin" },
      { version: 2, preset: "neo-brutalism" },
      { version: 2, preset: "constructor" },
      { version: 2, preset: "</script><script>bad()" },
      { version: 1, base: "mist" },
      null,
      "blocked",
    ]) {
      const styles: Array<{ id: string; textContent: string }> = [];
      const doc = {
        documentElement: { dataset: {} },
        createElement: () => ({ id: "", textContent: "" }),
        head: { appendChild: (style: { id: string; textContent: string }) => styles.push(style) },
      };
      runInNewContext(themeBootstrapScript(), {
        document: doc,
        localStorage: {
          getItem: () => {
            if (input === "blocked") throw Error("blocked");
            return JSON.stringify(input);
          },
        },
      });
      const expected = parseThemePreference(input === "blocked" ? null : JSON.stringify(input));
      expect(styles[0].textContent).toBe(themeCss(expected));
      expect(doc.documentElement.dataset).toEqual({ themePreset: expected.preset });
      expect(styles[0].textContent).not.toContain("bad()");
    }
  });
});
