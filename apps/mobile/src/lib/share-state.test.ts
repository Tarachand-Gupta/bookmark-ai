import assert from "node:assert/strict";
import { test } from "node:test";
import { bindShare, canConsumeShare, createShareClaims, shareForAccount } from "./share-state";
const unsigned = { id: "job1", url: "https://example.com/private", owner: null };
test("signed-out share survives login but cannot save until owned", () => {
  assert.deepEqual(shareForAccount(unsigned, null, true), unsigned);
  assert.equal(shareForAccount(unsigned, "alice", true), null);
  const bound = bindShare(unsigned, "alice");
  assert.equal(shareForAccount(bound, "alice", true), bound);
  assert.equal(shareForAccount(bound, "bob", true), null);
  assert.equal(shareForAccount(bound, null, true), null);
  assert.equal(bindShare(bound, "bob"), bound, "account switch must never reassign an owned share");
});
test("restoration waits for SDK account determination", () => {
  const record = bindShare(unsigned, "alice");
  assert.equal(shareForAccount(record, null, false), record);
});
test("strict-mode reruns claim a capture once and old completion cannot consume new capture", () => {
  const claim = createShareClaims();
  assert.equal(claim("job1"), true); assert.equal(claim("job1"), false); assert.equal(claim("job2"), true);
  assert.equal(canConsumeShare({ ...unsigned, id: "job2" }, "job1"), false);
  assert.equal(canConsumeShare(unsigned, "job1"), true); assert.equal(canConsumeShare(null, "job1"), false);
});
