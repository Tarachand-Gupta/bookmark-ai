import { describe, expect, it, vi } from "vitest";

vi.mock("./diag", () => ({ diag: vi.fn() }));

import {
  isApiProxyMessage,
  isApiProxyPathAllowed,
  API_PROXY,
} from "./messages";

/**
 * The API proxy is the newtab page's ONLY network path — a path-allowlisted,
 * verb-whitelisted relay through the background (see messages.ts API_PROXY).
 * These tests pin the allowlist's path boundaries: prefix bugs here would
 * widen the extension's callable surface.
 */
describe("API proxy allowlist", () => {
  it("allows the newtab/wizard/chat/read routes", () => {
    for (const path of [
      "/api/newtab/templates",
      "/api/newtab/templates?x=1",
      "/api/newtab/templates/preset:favorites",
      "/api/newtab/templates/abc-123/activate",
      "/api/newtab/settings",
      "/api/newtab/wizard",
      "/api/chat",
      "/api/search?q=react&mode=hybrid&limit=20",
      "/api/bookmarks?limit=24",
      "/api/bookmarks/c55c7f10-0000-4000-8000-000000000000",
      "/api/meta",
      "/api/sessions",
    ]) {
      expect(isApiProxyPathAllowed(path), path).toBe(true);
    }
  });

  it("rejects out-of-scope and boundary-confusable paths", () => {
    for (const path of [
      "/api/export",
      "/api/import",
      "/api/admin",
      "/api/me",
      "/api/settings",
      "/api/live",
      "/api/bookmarksXYZ", // prefix-sharing decoy: must NOT match /api/bookmarks
      "/api/newtabx",
      "/api/chatter",
      "https://bookmark-ai.cloud/api/chat", // absolute URLs are not relative paths
      "/api/../api/export",
      "/APi/newtab/templates",
      "",
      "/",
    ]) {
      expect(isApiProxyPathAllowed(path), path).toBe(false);
    }
  });

  it("the message guard requires the type, a whitelisted verb, and a relative path", () => {
    const base = { type: API_PROXY, path: "/api/newtab/settings" };
    expect(isApiProxyMessage({ ...base, method: "GET" })).toBe(true);
    expect(isApiProxyMessage({ ...base, method: "DELETE" })).toBe(true);
    expect(isApiProxyMessage({ ...base, method: "PUT" })).toBe(false);
    expect(isApiProxyMessage({ ...base, method: "get-thing" })).toBe(false);
    expect(isApiProxyMessage({ ...base, method: 5 })).toBe(false);
    expect(isApiProxyMessage({ ...base, method: "GET", path: 42 })).toBe(false);
    expect(isApiProxyMessage({ method: "GET", path: "/api/meta" })).toBe(false);
    expect(isApiProxyMessage(null)).toBe(false);
  });
});
