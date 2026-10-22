import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { browser } from "wxt/browser";
import {
  bookmarkMirroringAllowed,
  canMirrorNativeBookmarks,
  ensureImportOnlyConsent,
  initializeBookmarkConsent,
  revokeBookmarkConsent,
  setBookmarkAdditionsConsent,
} from "./native-bookmark-consent";

const permissions = browser.permissions as unknown as {
  contains: (request: { permissions: string[] }) => Promise<boolean>;
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe("bookmark permission and separate sync consent", () => {
  it("keeps denied and import-only grants off on a new install", async () => {
    const permission = vi.spyOn(permissions, "contains").mockResolvedValue(false);
    expect(await initializeBookmarkConsent()).toMatchObject({ additions: false, removals: false });
    expect(await canMirrorNativeBookmarks()).toBe(false);
    permission.mockResolvedValue(true);
    await ensureImportOnlyConsent();
    expect(await canMirrorNativeBookmarks()).toBe(false);
    expect(await canMirrorNativeBookmarks("remove")).toBe(false);
  });

  it("preserves existing granted installs across an upgrade", async () => {
    vi.spyOn(permissions, "contains").mockResolvedValue(true);
    expect(await initializeBookmarkConsent()).toMatchObject({ additions: true, removals: true });
    expect(await canMirrorNativeBookmarks()).toBe(true);
    expect(await canMirrorNativeBookmarks("remove")).toBe(true);
  });

  it("requires an explicit additions choice and never includes deletion consent", async () => {
    vi.spyOn(permissions, "contains").mockResolvedValue(true);
    await ensureImportOnlyConsent();
    await setBookmarkAdditionsConsent(true);
    expect(await canMirrorNativeBookmarks()).toBe(true);
    expect(await canMirrorNativeBookmarks("remove")).toBe(false);
    await setBookmarkAdditionsConsent(false);
    expect(await canMirrorNativeBookmarks()).toBe(false);
  });

  it("revocation stops writes and regranting access does not resume sync", async () => {
    const permission = vi.spyOn(permissions, "contains").mockResolvedValue(true);
    await initializeBookmarkConsent();
    permission.mockResolvedValue(false);
    expect(await canMirrorNativeBookmarks()).toBe(false);
    await revokeBookmarkConsent();
    permission.mockResolvedValue(true);
    await ensureImportOnlyConsent();
    expect(await canMirrorNativeBookmarks()).toBe(false);
    expect(await canMirrorNativeBookmarks("remove")).toBe(false);
  });

  it("never calls account-disabled or unverified sync active", () => {
    const consent = { version: 1 as const, additions: true, removals: true };
    expect(bookmarkMirroringAllowed(consent, true, false)).toBe(false);
    expect(bookmarkMirroringAllowed(consent, false, true)).toBe(false);
    expect(bookmarkMirroringAllowed(consent, true, true)).toBe(true);
    expect(bookmarkMirroringAllowed(consent, true, true, "remove", false)).toBe(false);
    expect(bookmarkMirroringAllowed(consent, true, true, "remove", true)).toBe(true);
  });
});
