import { describe, expect, it } from "vitest";
import {
  hostPatternsOf,
  patchGetManifest,
  withHostPermissions,
  type ManifestLike,
  type RuntimeLike,
} from "./manifest-shim";

/**
 * Firefox MV2 strips `host_permissions` from `runtime.getManifest()`, and
 * `@clerk/chrome-extension` throws without it. These pin the shim that keeps
 * the background's SDK rung alive on Firefox (see lib/manifest-shim.ts).
 */

const MV2_PERMISSIONS = [
  "activeTab",
  "tabs",
  "storage",
  "alarms",
  "cookies",
  "bookmarks",
  "http://localhost/*",
  "https://bookmark-ai.cloud/*",
  "https://clerk.bookmark-ai.cloud/*",
];

describe("hostPatternsOf", () => {
  it("keeps only host match patterns", () => {
    expect(hostPatternsOf(MV2_PERMISSIONS)).toEqual([
      "http://localhost/*",
      "https://bookmark-ai.cloud/*",
      "https://clerk.bookmark-ai.cloud/*",
    ]);
  });

  it("recognizes <all_urls> and wildcard schemes, tolerates undefined", () => {
    expect(hostPatternsOf(["<all_urls>", "*://*/*", "storage"])).toEqual(["<all_urls>", "*://*/*"]);
    expect(hostPatternsOf(undefined)).toEqual([]);
  });
});

describe("withHostPermissions", () => {
  it("returns the same object when host_permissions already exists (MV3)", () => {
    const manifest = { manifest_version: 3, permissions: ["storage"], host_permissions: ["https://a/*"] };
    expect(withHostPermissions(manifest)).toBe(manifest);
  });

  it("derives host_permissions from MV2 permissions without mutating the input", () => {
    const manifest: ManifestLike = { manifest_version: 2, permissions: MV2_PERMISSIONS };
    const out = withHostPermissions(manifest);
    expect(out).not.toBe(manifest);
    expect(out.host_permissions).toEqual(hostPatternsOf(MV2_PERMISSIONS));
    expect("host_permissions" in manifest).toBe(false);
  });

  it("still yields a truthy (empty) array when no host patterns exist — the SDK only checks presence", () => {
    const manifest: ManifestLike = { permissions: ["storage"] };
    expect(withHostPermissions(manifest).host_permissions).toEqual([]);
  });
});

describe("patchGetManifest", () => {
  it("patches an MV2-style runtime so getManifest carries host_permissions", () => {
    const runtime: RuntimeLike = {
      getManifest: () => ({ manifest_version: 2, permissions: MV2_PERMISSIONS }),
    };
    expect(patchGetManifest(runtime)).toBe("patched");
    expect(runtime.getManifest!().host_permissions).toEqual(hostPatternsOf(MV2_PERMISSIONS));
    // Everything else passes through untouched.
    expect(runtime.getManifest!().manifest_version).toBe(2);
  });

  it("is a no-op on an MV3 runtime that already exposes the key", () => {
    const getManifest = () => ({ manifest_version: 3, host_permissions: ["https://a/*"] });
    const runtime = { getManifest };
    expect(patchGetManifest(runtime)).toBe("unneeded");
    expect(runtime.getManifest).toBe(getManifest);
  });

  it("reports unavailable without a runtime or getManifest", () => {
    expect(patchGetManifest(undefined)).toBe("unavailable");
    expect(patchGetManifest({})).toBe("unavailable");
  });

  it("reports failed (and leaves the runtime intact) when the property cannot be replaced", () => {
    const runtime: { getManifest: () => { permissions: string[] } } = Object.create(null);
    Object.defineProperty(runtime, "getManifest", {
      value: () => ({ permissions: MV2_PERMISSIONS }),
      configurable: false,
      writable: false,
    });
    expect(patchGetManifest(runtime)).toBe("failed");
    expect(runtime.getManifest().permissions).toEqual(MV2_PERMISSIONS);
  });

  it("reports failed when the original getManifest throws", () => {
    const runtime = {
      getManifest: () => {
        throw new Error("boom");
      },
    };
    expect(patchGetManifest(runtime)).toBe("failed");
  });
});
