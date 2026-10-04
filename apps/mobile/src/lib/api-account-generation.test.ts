import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Execute the actual API module with only native/config boundaries substituted.
// Response parsing stays asynchronous so an account switch can occur mid-body.
function apiWith(fetch: typeof globalThis.fetch) {
  const source = readFileSync(new URL("../api.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, any> };
  const require = (name: string) => {
    if (name === "react-native") return { Platform: { OS: "ios", isPad: false } };
    if (name === "./lib/auth-config") return { BUILD_VARIANT: "supabase-qa" };
    if (name === "./lib/native-endpoints") return { nativeEndpoint: (url: string) => url };
    if (name === "./lib/appUpdate") return {};
    throw new Error(`Unexpected boundary: ${name}`);
  };
  new Function("require", "module", "exports", "fetch", "process", "__DEV__", code)(require, module, module.exports, fetch, { env: { EXPO_PUBLIC_API_URL: "http://fixture.invalid", EXPO_PUBLIC_LIVE_API_URL: "http://fixture.invalid" } }, true);
  return module.exports;
}
for (const surface of ["main", "live"]) {
  test(`${surface}: delayed old-account MFA error cannot gate the new account`, async () => {
    let release!: (body: object) => void, parsing!: () => void;
    const started = new Promise<void>((resolve) => { parsing = resolve; });
    const api = apiWith(async () => ({ ok: false, status: 403, json: () => { parsing(); return new Promise((resolve) => { release = resolve; }); } }) as unknown as Response);
    let gated = 0; api.setMfaRequiredHandler(() => gated++); api.setAuthTokenProvider(async () => "fixture-token");
    const request = surface === "main" ? api.listAuthSessions() : api.listLiveDevices();
    await started; api.resetAccountApiState(); release({ code: "mfa-required", error: "Verify MFA" });
    await assert.rejects(request, /account changed/); assert.equal(gated, 0);
  });
  test(`${surface}: current-account MFA error requests verification`, async () => {
    const api = apiWith(async () => ({ ok: false, status: 403, json: async () => ({ code: "mfa-required", error: "Verify MFA" }) }) as Response);
    let gated = 0; api.setMfaRequiredHandler(() => gated++); api.setAuthTokenProvider(async () => "fixture-token");
    await assert.rejects(surface === "main" ? api.listAuthSessions() : api.listLiveDevices(), /Verify MFA/); assert.equal(gated, 1);
  });
}
