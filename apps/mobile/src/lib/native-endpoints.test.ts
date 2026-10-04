import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeEndpoint, assertAuthEndpoints } from "./native-endpoints";
test("one QA Metro maps loopback for Android while preserving iOS, LAN and live port", () => {
  assert.equal(nativeEndpoint("http://localhost:3100", "ios"), "http://localhost:3100");
  assert.equal(nativeEndpoint("http://localhost:3100", "android"), "http://10.0.2.2:3100");
  assert.equal(nativeEndpoint("http://127.0.0.1:3101", "android"), "http://10.0.2.2:3101");
  assert.equal(nativeEndpoint("http://192.168.1.100:3101", "android"), "http://192.168.1.100:3101");
});

test("explicit hosted endpoints retain canonical authorization without a default production fallback",()=>{
  assert.doesNotThrow(()=>assertAuthEndpoints("production","https://www.bookmark-ai.cloud","https://live.bookmark-ai.cloud"));
  for(const api of ["https://bookmark-ai.cloud","http://www.bookmark-ai.cloud","https://evil.bookmark-ai.cloud","https://www.bookmark-ai.cloud/api","https://www.bookmark-ai.cloud.evil.invalid"])assert.throws(()=>assertAuthEndpoints("production",api,"https://live.bookmark-ai.cloud"));
  assert.throws(()=>assertAuthEndpoints(undefined,"https://www.bookmark-ai.cloud","http://localhost:3101"));
  assert.throws(()=>assertAuthEndpoints("other","http://localhost:3100","http://localhost:3101"));
});
