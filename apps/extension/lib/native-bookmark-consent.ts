import { storage } from "#imports";
import { browser } from "wxt/browser";

export interface NativeBookmarkConsent {
  version: 1;
  additions: boolean;
  removals: boolean;
}

const consentItem = storage.defineItem<NativeBookmarkConsent | null>(
  "local:nativeBookmarkConsent",
  { fallback: null },
);

export const NO_BOOKMARK_CONSENT: NativeBookmarkConsent = {
  version: 1,
  additions: false,
  removals: false,
};

/** Existing installs already had a required permission and native mirroring.
 * New installs have no grant. A later import grant never changes this record. */
export function initialBookmarkConsent(
  previous: NativeBookmarkConsent | null,
  permission: boolean,
): NativeBookmarkConsent {
  if (previous?.version === 1) return previous;
  return { version: 1, additions: permission, removals: permission };
}

export async function hasBookmarkPermission(): Promise<boolean> {
  if (import.meta.env.BROWSER === "safari") return false;
  return browser.permissions.contains({ permissions: ["bookmarks"] }).catch(() => false);
}

export async function initializeBookmarkConsent(): Promise<NativeBookmarkConsent> {
  const previous = await consentItem.getValue();
  if (previous?.version === 1) return previous;
  const initial = initialBookmarkConsent(previous, await hasBookmarkPermission());
  await consentItem.setValue(initial);
  return initial;
}

/** Called by the permission-added event, never inferring consent from a grant. */
export async function ensureImportOnlyConsent(): Promise<void> {
  if (!(await consentItem.getValue())) await consentItem.setValue(NO_BOOKMARK_CONSENT);
}

export async function setBookmarkAdditionsConsent(enabled: boolean): Promise<void> {
  // This action only authorizes additions. Deletions need their own explicit UI.
  await consentItem.setValue({ version: 1, additions: enabled, removals: false });
}

export async function revokeBookmarkConsent(): Promise<void> {
  await consentItem.setValue(NO_BOOKMARK_CONSENT);
}

export function bookmarkMirroringAllowed(
  consent: NativeBookmarkConsent,
  permission: boolean,
  accountEnabled: boolean,
  operation: "add" | "remove" = "add",
  accountFullSync = false,
): boolean {
  return (
    permission &&
    accountEnabled &&
    consent.additions &&
    (operation === "add" || (consent.removals && accountFullSync))
  );
}

export async function canMirrorNativeBookmarks(
  operation: "add" | "remove" = "add",
): Promise<boolean> {
  try {
    const permission = await hasBookmarkPermission();
    const consent = await initializeBookmarkConsent();
    return permission && consent.additions && (operation === "add" || consent.removals);
  } catch {
    return false;
  }
}
