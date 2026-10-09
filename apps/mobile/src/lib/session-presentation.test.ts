import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthSession } from "../api";
import { groupSessions, presentSession } from "./session-presentation";
const session = (id: string, clientType: string, overrides: Partial<AuthSession> = {}): AuthSession => ({ id, clientType, displayName: "Unknown device", browser: null, os: null, createdAt: "2026-10-09T00:00:00Z", lastActiveAt: null, isCurrent: false, ...overrides });
test("device groups use registered client type, retain every ID and keep current session first", () => {
  const entries = [session("web-chrome", "web", { browser: "Chrome" }), session("ext-chrome", "chrome-extension"), session("current", "android", { isCurrent: true }), session("same-name", "web"), session("firefox", "firefox-extension"), session("safari", "safari-extension"), session("pwa", "pwa"), session("ios", "ios"), session("mac", "macos")];
  const groups = groupSessions(entries);
  assert.equal(groups.apps[0].id, "current");
  assert.deepEqual(groups.extensions.map(x => x.id), ["ext-chrome", "firefox", "safari"]);
  assert.deepEqual([...groups.apps, ...groups.extensions].map(x => x.id).sort(), entries.map(x => x.id).sort());
  assert.ok(groups.apps.some(x => x.id === "web-chrome"));
  assert.ok(groups.apps.some(x => x.id === "same-name"));
});
test("friendly defaults hide emulator slugs while explicit names and platform metadata survive", () => {
  assert.equal(presentSession(session("a", "android", { displayName: "sdk_gphone64_arm64", os: "android 16" })).title, "Android app");
  assert.equal(presentSession(session("a", "macos", { displayName: "My work laptop" })).title, "My work laptop");
  assert.equal(presentSession(session("a", "web", { browser: "Chrome", os: "macos" })).metadata, "Website · Chrome · macOS");
  assert.equal(presentSession(session("a", "future-platform")).group, "apps");
});
