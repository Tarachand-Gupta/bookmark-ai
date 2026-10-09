import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { extensionBuildArguments } from "./wxt-build-policy.mjs";

test("ordinary build and zip cannot silently produce a Clerk artifact", () => {
  for (const command of ["build", "zip"]) {
    for (const options of [[], ["-m", "production"], ["-m", "development"], ["-m", "dev-remote"]]) {
      assert.throws(() => extensionBuildArguments([command, ...options], {}), /qa:supabase chrome build --hosted-production/);
    }
  }
});

test("QA mode accepts supported mode spellings without changing browser arguments", () => {
  for (const mode of [["-m", "supabase-qa"], ["--mode", "supabase-qa"], ["--mode=supabase-qa"], ["-m=supabase-qa"]]) {
    const args = ["build", "-b", "firefox", "--mv2", ...mode];
    assert.deepEqual(extensionBuildArguments(args), { args, legacyClerk: false });
  }
});

test("production mode requires frozen Supabase production context", () => {
  const args = ["build", "-b", "chrome", "-m", "production"];
  const env = { BOOKMARK_BUILD_VARIANT: "supabase-production", BOOKMARK_PRODUCTION_STAGE_ROOT: "/frozen/source", WXT_AUTH_PROVIDER: "supabase" };
  assert.deepEqual(extensionBuildArguments(args, env), { args, legacyClerk: false });
  for (const key of Object.keys(env)) assert.throws(() => extensionBuildArguments(args, { ...env, [key]: "" }));
});

test("missing or conflicting mode arguments fail closed", () => {
  for (const args of [
    ["build", "-m"],
    ["build", "--mode"],
    ["build", "-m", "supabase-qa", "--mode", "production"],
    ["zip", "--mode=production", "-m", "supabase-qa"],
  ]) assert.throws(() => extensionBuildArguments(args), /Supabase extension build/);
});

test("rollback requires an explicit flag and removes it before WXT", () => {
  for (const command of ["build", "zip"]) {
    assert.deepEqual(extensionBuildArguments([command, "-b", "chrome", "--legacy-clerk"]), {
      args: [command, "-b", "chrome"], legacyClerk: true,
    });
  }
  assert.throws(() => extensionBuildArguments(["build", "--legacy-clerk=true"]), /Supabase extension build/);
});

test("prepare and dev retain their existing behavior", () => {
  for (const args of [["prepare"], ["dev", "-m", "development"]]) {
    assert.deepEqual(extensionBuildArguments(args), { args, legacyClerk: false });
  }
});

test("help and version remain available without producing an artifact", () => {
  for (const args of [["--help"], ["--version"], ["build", "--help"], ["zip", "-h"]]) {
    assert.deepEqual(extensionBuildArguments(args), { args, legacyClerk: false });
  }
});

test("wrapper rejects ordinary build and zip before launching WXT", () => {
  const wrapper = fileURLToPath(new URL("./wxt-run.mjs", import.meta.url));
  for (const command of ["build", "zip"]) {
    const result = spawnSync(process.execPath, [wrapper, command], {
      encoding: "utf8", env: { ...process.env, PATH: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Ordinary \.output builds use legacy Clerk authentication/);
    assert.doesNotMatch(result.stderr, /ENOENT|spawn wxt/);
    assert.equal(result.stdout, "");
  }
});
