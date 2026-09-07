import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDark } from "./appearance";

describe("resolveDark", () => {
  it('"system" follows the OS in both directions', () => {
    assert.equal(resolveDark("system", "light"), false);
    assert.equal(resolveDark("system", "dark"), true);
    // The same preference flips as the OS flips — what the Settings modal has
    // to show LIVE, without being closed and reopened.
    assert.notEqual(resolveDark("system", "light"), resolveDark("system", "dark"));
  });

  it('"system" is light while the OS scheme is still unknown', () => {
    assert.equal(resolveDark("system", null), false);
    assert.equal(resolveDark("system", undefined), false);
    assert.equal(resolveDark("system", "unspecified"), false);
  });

  it("an explicit choice ignores the OS entirely", () => {
    assert.equal(resolveDark("light", "dark"), false);
    assert.equal(resolveDark("light", "light"), false);
    assert.equal(resolveDark("dark", "light"), true);
    assert.equal(resolveDark("dark", "dark"), true);
    assert.equal(resolveDark("dark", null), true);
  });
});
