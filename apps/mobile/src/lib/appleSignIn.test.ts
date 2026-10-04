import assert from "node:assert/strict";
import { test } from "node:test";
import { appleButtonStyle, appleSignInPresentation, describeAppleSignInError, hasAppleAccount, offersAppleSignIn } from "./appleSignIn";
test("iOS keeps its native Apple button and Android offers hosted browser Apple sign-in", () => {
  assert.equal(offersAppleSignIn("ios"), true); assert.equal(offersAppleSignIn("android"), true);
  assert.equal(appleSignInPresentation("ios"), "native");
  assert.equal(appleSignInPresentation("android"), "browser");
  assert.equal(appleSignInPresentation("web"), null); assert.equal(offersAppleSignIn("windows"), false);
  assert.equal(appleButtonStyle(false), "BLACK"); assert.equal(appleButtonStyle(true), "WHITE");
  assert.deepEqual(describeAppleSignInError({ code: "ERR_REQUEST_CANCELED" }), { kind: "cancelled" });
  assert.equal(describeAppleSignInError({ code: "ERR_REQUEST_UNKNOWN" }).kind, "apple");
  assert.equal(hasAppleAccount([{ provider: "google" }, { provider: "apple" }]), true);
});
