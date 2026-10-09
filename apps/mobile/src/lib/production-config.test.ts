import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { assertAuthEndpoints } from "./native-endpoints";

const require = createRequire(import.meta.url);
const base = {
  EXPO_PUBLIC_AUTH_PROVIDER: "supabase", EXPO_PUBLIC_BUILD_VARIANT: "supabase-production",
  EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE: "bookmark-ai:supabase-production",
  EXPO_PUBLIC_AUTH_REDIRECT_URL: "bookmarkai://sso-callback", EXPO_PUBLIC_HOSTED_TARGET: "production",
  EXPO_PUBLIC_SERVER_TARGET: "production", EXPO_PUBLIC_API_URL: "https://www.bookmark-ai.cloud",
  EXPO_PUBLIC_LIVE_API_URL: "https://live.bookmark-ai.cloud", EXPO_PUBLIC_SUPABASE_URL: "https://xogqaqtyacmecdbmgqqd.supabase.co",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
};
function loadConfig(env: Record<string, string | undefined>) {
  const code = ts.transpileModule(readFileSync(new URL("./auth-config.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", code)(() => ({ assertAuthEndpoints }), module, module.exports, { env });
  return module.exports;
}
test("production public configuration rejects mixed provider, QA callback, namespace and local hosts", () => {
  assert.doesNotThrow(() => loadConfig(base));
  for (const [key, value] of [
    ["EXPO_PUBLIC_AUTH_PROVIDER", "clerk"], ["EXPO_PUBLIC_AUTH_REDIRECT_URL", "bookmarkai-supabase-qa://sso-callback"],
    ["EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE", "bookmark-ai:supabase-qa"], ["EXPO_PUBLIC_HOSTED_TARGET", ""],
    ["EXPO_PUBLIC_SERVER_TARGET", "local"], ["EXPO_PUBLIC_API_URL", "http://localhost:3000"],
    ["EXPO_PUBLIC_LIVE_API_URL", "http://10.0.2.2:8091"], ["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ""],
  ]) assert.throws(() => loadConfig({ ...base, [key]: value }));
});
test("explicit hosted QA retains its separate callback and namespace", () => {
  assert.doesNotThrow(() => loadConfig({ ...base, EXPO_PUBLIC_BUILD_VARIANT: "supabase-qa", EXPO_PUBLIC_AUTH_STORAGE_NAMESPACE: "bookmark-ai:supabase-qa", EXPO_PUBLIC_AUTH_REDIRECT_URL: "bookmarkai-supabase-qa://sso-callback" }));
});
test("production native config preserves registered IDs and requires frozen staging", () => {
  const appConfig = require("../../app.config.js");
  const config = require("../../app.json").expo;
  const originalVariant = process.env.BOOKMARK_BUILD_VARIANT, originalStage = process.env.BOOKMARK_PRODUCTION_STAGE_ROOT;
  try {
    process.env.BOOKMARK_BUILD_VARIANT = "supabase-production";
    delete process.env.BOOKMARK_PRODUCTION_STAGE_ROOT;
    assert.throws(() => appConfig({ config }), /production build wrapper/);
    process.env.BOOKMARK_PRODUCTION_STAGE_ROOT = "/fixture/frozen";
    const result = appConfig({ config });
    assert.equal(result.ios.bundleIdentifier, "ai.bookmarkai");
    assert.equal(result.android.package, "ai.bookmarkai");
    assert.equal(result.scheme, "bookmarkai");
    assert.equal(result.name, "Bookmark AI");
    assert.deepEqual(result.ios.entitlements["com.apple.security.application-groups"], ["group.ai.bookmarkai"]);
  } finally {
    if (originalVariant === undefined) delete process.env.BOOKMARK_BUILD_VARIANT; else process.env.BOOKMARK_BUILD_VARIANT = originalVariant;
    if (originalStage === undefined) delete process.env.BOOKMARK_PRODUCTION_STAGE_ROOT; else process.env.BOOKMARK_PRODUCTION_STAGE_ROOT = originalStage;
  }
});
test("production Gradle release refuses the development debug signing fallback", () => {
  const { patchBuildGradle } = require("../../plugins/withReleaseSigning.js");
  const gradle = "signingConfigs {\n    debug {\n        storeFile file('debug.keystore')\n    }\n}\nbuildTypes {\n    release {\n        signingConfig signingConfigs.debug\n    }\n}";
  assert.match(patchBuildGradle(gradle), /WARNING: ANDROID_KEYSTORE/);
  const production = patchBuildGradle(gradle, true);
  assert.match(production, /throw new GradleException\("Production release requires/);
  assert.doesNotMatch(production, /WARNING: ANDROID_KEYSTORE/);
  assert.match(production, /signingConfig signingConfigs.release/);
});
