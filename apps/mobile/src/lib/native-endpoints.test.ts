import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeEndpoint } from "./native-endpoints";
test("one QA Metro maps loopback for Android while preserving iOS, LAN and live port", () => {
  assert.equal(nativeEndpoint("http://localhost:3100", "ios"), "http://localhost:3100");
  assert.equal(nativeEndpoint("http://localhost:3100", "android"), "http://10.0.2.2:3100");
  assert.equal(nativeEndpoint("http://127.0.0.1:3101", "android"), "http://10.0.2.2:3101");
  assert.equal(nativeEndpoint("http://192.168.1.100:3101", "android"), "http://192.168.1.100:3101");
});
