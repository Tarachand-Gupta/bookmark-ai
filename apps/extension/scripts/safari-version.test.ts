import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveBuildNumber,
  parseVersion,
  parseXcconfig,
  renderXcconfig,
  XCCONFIG_PATH,
} from "./safari-version.mjs";

describe("safari-version: build-number encoding", () => {
  it("encodes major.minor.patch into a monotonic numeric CFBundleVersion", () => {
    expect(deriveBuildNumber("0.1.2")).toBe(10200);
    expect(deriveBuildNumber("0.1.3")).toBe(10300);
    expect(deriveBuildNumber("1.0.0")).toBe(1_000_000);
    expect(deriveBuildNumber("0.1.2")).toBeLessThan(deriveBuildNumber("0.2.0"));
    expect(deriveBuildNumber("0.99.99")).toBeLessThan(deriveBuildNumber("1.0.0"));
  });

  it("leaves two digits for re-uploads of the same marketing version", () => {
    expect(deriveBuildNumber("0.1.2", 1)).toBe(10201);
    expect(deriveBuildNumber("0.1.2", "7")).toBe(10207);
    // A re-upload of 0.1.2 must never collide with the next version's first build.
    expect(deriveBuildNumber("0.1.2", 99)).toBeLessThan(deriveBuildNumber("0.1.3"));
    expect(() => deriveBuildNumber("0.1.2", 100)).toThrow(/0–99/);
    expect(() => deriveBuildNumber("0.1.2", -1)).toThrow(/0–99/);
  });

  it("rejects anything Apple would reject", () => {
    expect(() => parseVersion("0.1.2-beta.1")).toThrow(/major\.minor\.patch/);
    expect(() => parseVersion("0.1")).toThrow(/major\.minor\.patch/);
    expect(() => parseVersion("v0.1.2")).toThrow(/major\.minor\.patch/);
    expect(() => parseVersion("0.100.0")).toThrow(/≤ 99/);
  });

  it("round-trips through the xcconfig format", () => {
    const text = renderXcconfig("0.1.2", 10200);
    expect(text).toMatch(/^MARKETING_VERSION = 0\.1\.2$/m);
    expect(text).toMatch(/^CURRENT_PROJECT_VERSION = 10200$/m);
    expect(parseXcconfig(text)).toEqual({ version: "0.1.2", build: 10200 });
  });
});

describe("safari-version: the committed Version.xcconfig matches package.json", () => {
  // Both targets of the Safari wrapper read this file, so a stale value ships a
  // Mac app whose CFBundleShortVersionString disagrees with the extension inside.
  it("is in sync (run `node scripts/safari-version.mjs --write` if this fails)", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
    const onDisk = parseXcconfig(readFileSync(XCCONFIG_PATH, "utf8"));
    expect(onDisk.version).toBe(pkg.version);
    expect(onDisk.build).toBe(deriveBuildNumber(pkg.version, 0));
  });
});
