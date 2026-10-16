import { expect, it } from "vitest";
import { isOAuthCallbackReadySender } from "./oauth-callback-sender";

const app = "https://www.bookmark-ai.cloud";
const valid = { id: "extension", url: `${app}/auth/extension-callback?state=not-logged&code=not-sent-by-ready`, tab: { id: 7 } };
it("admits the extension's own hosted callback content script for a readiness check", () => {
  expect(isOAuthCallbackReadySender(valid, "extension", app)).toBe(true);
});
it.each([
  { ...valid, id: "foreign-extension" },
  { ...valid, id: undefined },
  { ...valid, tab: undefined },
  { ...valid, tab: { id: undefined } },
  { ...valid, url: "https://evil.example/auth/extension-callback" },
  { ...valid, url: `${app}/oauth/consent` },
  { ...valid, url: `${app}/auth/extension-callback/extra` },
  { ...valid, url: "not-a-url" },
])("rejects an untrusted readiness sender %j", sender => {
  expect(isOAuthCallbackReadySender(sender, "extension", app)).toBe(false);
});
