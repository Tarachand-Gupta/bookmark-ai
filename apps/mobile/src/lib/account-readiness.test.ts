import assert from "node:assert/strict";
import { test } from "node:test";
import { accountProbeFailure } from "./account-readiness";

test("unconfirmed accounts cannot open an empty shell on API failure", () => {
  assert.equal(accountProbeFailure("unavailable", false, false, false), "setup-error");
  assert.equal(accountProbeFailure("provisioning", false, true, true), "setup-error");
  assert.equal(accountProbeFailure("unavailable", false, true, true), "setup-error");
});
test("provisioning blocks a previous ready marker and transient errors keep its feedback", () => {
  assert.equal(accountProbeFailure("provisioning", true, false, false), "provisioning");
  assert.equal(accountProbeFailure("unavailable", true, true, false), "provisioning");
  assert.equal(accountProbeFailure("unavailable", true, true, true), "setup-error");
});
test("confirmed returning accounts retain offline access and forbidden always blocks", () => {
  assert.equal(accountProbeFailure("unavailable", true, false, false), "ok");
  assert.equal(accountProbeFailure("forbidden", true, false, false), "forbidden");
  assert.equal(accountProbeFailure("forbidden", false, true, true), "forbidden");
});
