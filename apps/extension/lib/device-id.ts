import { storage } from "#imports";
import { detectBrowser, detectDeviceName } from "./detect";

/**
 * Durable per-install identity for Live Sessions. The id is the server row key
 * (§4.2), so it must outlive worker termination and browser restart — minted
 * once, then persisted with the same `storage.defineItem` pattern the API-url
 * item in ./api uses. The label is a user-renamable display name seeded from the
 * browser/OS; the popup is the only surface that knows which physical machine
 * this is, so renaming lives there (§4.5).
 */

const deviceIdItem = storage.defineItem<string>("local:liveDeviceId", { fallback: "" });
const deviceLabelItem = storage.defineItem<string>("local:liveDeviceLabel", { fallback: "" });

const MAX_LABEL = 80; // pushLiveStateSchema.label cap

/** Seeded label like "Chrome on Mac"; falls back to just the browser when the OS
 * is unknown. */
export function defaultDeviceLabel(): string {
  const browser = detectBrowser();
  const browserLabel = browser.charAt(0).toUpperCase() + browser.slice(1);
  const name = detectDeviceName();
  return name ? `${browserLabel} on ${name}` : browserLabel;
}

/** The durable device id, minting and persisting one on first use. */
export async function getDeviceId(): Promise<string> {
  const existing = await deviceIdItem.getValue();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await deviceIdItem.setValue(id);
  return id;
}

/** Read the id WITHOUT minting one — for teardown paths that must not resurrect a
 * device that never published. */
export async function peekDeviceId(): Promise<string> {
  return deviceIdItem.getValue();
}

export async function getDeviceLabel(): Promise<string> {
  const stored = await deviceLabelItem.getValue();
  return stored || defaultDeviceLabel();
}

export async function setDeviceLabel(label: string): Promise<void> {
  await deviceLabelItem.setValue(label.trim().slice(0, MAX_LABEL));
}
