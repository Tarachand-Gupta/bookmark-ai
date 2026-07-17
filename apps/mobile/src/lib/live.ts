import type { Browser, DeviceType, LiveDevice } from "@bookmark-ai/types";
import type { SymbolViewProps } from "expo-symbols";

/**
 * Freshness rendering (§4.4). The server owns age: it returns the integer
 * `lastSeenAgeSeconds`, and clients render THAT — never a difference of the
 * client's own clock against an ISO string. These helpers turn that integer
 * into a label, a dot state, and a dimming decision; they take a number, so no
 * caller can accidentally re-introduce a local clock read.
 */

/** A device this old or older is stale — hollow dot, dimmed card (§4.4). */
const STALE_AFTER_SECONDS = 600;

/** Dimming applied to a stale device's cards (mock: ~55%). */
export const STALE_OPACITY = 0.55;

export function isStale(ageSeconds: number): boolean {
  return ageSeconds >= STALE_AFTER_SECONDS;
}

/**
 * Relative age phrase, softened toward live-ish at the low end (§4.4 rework):
 * "just now" up to ~15s, "a few seconds ago" under a minute, then coarsening.
 * Returns the bare phrase; callers prefix "as of ".
 */
export function ageLabel(ageSeconds: number): string {
  const s = Math.max(0, Math.floor(ageSeconds));
  if (s < 15) return "just now";
  if (s < 60) return "a few seconds ago";
  if (s < 3600) {
    const m = Math.max(1, Math.round(s / 60));
    return `${m} min ago`;
  }
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const BROWSER_LABELS: Record<Browser, string> = {
  chrome: "Chrome",
  firefox: "Firefox",
  safari: "Safari",
  edge: "Edge",
  arc: "Arc",
  other: "Browser",
};

export function browserLabel(browser: Browser): string {
  return BROWSER_LABELS[browser] ?? "Browser";
}

/** The recognizable name for a device row — the user-set label, or a browser
 * fallback so an unnamed device never renders as an empty string. */
export function deviceDisplayLabel(device: Pick<LiveDevice, "label" | "browser">): string {
  return device.label.trim() || `${browserLabel(device.browser)} device`;
}

/** Heading line for a device section: "Tara's MacBook · Chrome". */
export function deviceHeading(device: Pick<LiveDevice, "label" | "browser" | "os">): string {
  const label = device.label.trim();
  if (label) return `${label} · ${browserLabel(device.browser)}`;
  const os = device.os?.trim();
  return os ? `${browserLabel(device.browser)} · ${os}` : browserLabel(device.browser);
}

/** SF Symbol + Android fallback glyph for a device class (§4.7 icons rule). */
export function deviceGlyph(device: DeviceType): {
  name: SymbolViewProps["name"];
  fallback: string;
} {
  switch (device) {
    case "laptop":
      return { name: "laptopcomputer", fallback: "💻" };
    case "desktop":
      return { name: "desktopcomputer", fallback: "🖥" };
    case "mobile":
      return { name: "iphone", fallback: "📱" };
    case "tablet":
      return { name: "ipad", fallback: "📱" };
    default:
      return { name: "display", fallback: "🖥" };
  }
}
