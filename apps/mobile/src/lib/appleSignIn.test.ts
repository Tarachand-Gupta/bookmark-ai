import assert from "node:assert/strict";
import { test } from "node:test";
import { appleButtonStyle, describeAppleSignInError, hasAppleAccount, offersAppleSignIn } from "./appleSignIn";
test("Apple presentation remains native/iOS-only and cancellation is silent", () => {
  assert.equal(offersAppleSignIn("ios"), true); assert.equal(offersAppleSignIn("android"), false);
  assert.equal(appleButtonStyle(false), "BLACK"); assert.equal(appleButtonStyle(true), "WHITE");
  assert.deepEqual(describeAppleSignInError({ code: "ERR_REQUEST_CANCELED" }), { kind: "cancelled" });
  assert.equal(describeAppleSignInError({ code: "ERR_REQUEST_UNKNOWN" }).kind, "apple");
  assert.equal(hasAppleAccount([{ provider: "google" }, { provider: "apple" }]), true);
});
