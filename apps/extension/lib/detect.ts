import type { Browser, DeviceType } from "@bookmark-ai/types";

/** Minimal typing for the (Chromium-only) navigator.userAgentData API. */
interface NavigatorUAData {
  brands: Array<{ brand: string; version: string }>;
  mobile: boolean;
  platform: string;
}

function uaData(): NavigatorUAData | undefined {
  return (navigator as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData;
}

/**
 * The build target pins Firefox/Safari; Chromium builds run in several
 * browsers, so we distinguish Edge/Arc at runtime via brands/userAgent.
 */
export function detectBrowser(): Browser {
  if (import.meta.env.BROWSER === "firefox") return "firefox";
  if (import.meta.env.BROWSER === "safari") return "safari";
  const brands = uaData()?.brands ?? [];
  if (
    brands.some((b) => b.brand === "Microsoft Edge") ||
    navigator.userAgent.includes("Edg/")
  ) {
    return "edge";
  }
  // Arc mostly masquerades as Chrome; catch it if it ever brands itself.
  if (brands.some((b) => b.brand === "Arc") || navigator.userAgent.includes("Arc/")) {
    return "arc";
  }
  return "chrome";
}

export function detectDevice(): DeviceType {
  const ua = navigator.userAgent;
  // iPadOS reports "Macintosh" but exposes multi-touch.
  if (/iPad|Tablet/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) {
    return "tablet";
  }
  if (uaData()?.mobile || /iPhone|Android.+Mobile/i.test(ua)) return "mobile";
  if (/Macintosh|Mac OS X/.test(ua)) return "laptop";
  if (/Windows|Linux|CrOS/i.test(ua)) return "desktop";
  return "other";
}

export function detectOs(): string | undefined {
  const platform = uaData()?.platform;
  if (platform) return platform;
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Android/.test(ua)) return "Android";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}

export function detectDeviceName(): string | undefined {
  const os = detectOs();
  switch (os) {
    case "macOS":
      return "Mac";
    case "Windows":
      return "Windows PC";
    case undefined:
      return undefined;
    default:
      return `${os} device`;
  }
}

/** Source fields for CreateBookmarkInput, captured at save time. */
export function detectSource() {
  return {
    browser: detectBrowser(),
    device: detectDevice(),
    deviceName: detectDeviceName(),
    os: detectOs(),
    savedAt: new Date().toISOString(),
  };
}
