import type { Browser, DeviceType } from "@bookmark-ai/types";

/** Best-effort source detection for saves made from the web app itself. */
export function detectSource(): { browser: Browser; device: DeviceType; os: string } {
  if (typeof navigator === "undefined") {
    return { browser: "other", device: "other", os: "unknown" };
  }
  const ua = navigator.userAgent;

  let browser: Browser = "other";
  if (/edg\//i.test(ua)) browser = "edge";
  else if (/firefox\//i.test(ua)) browser = "firefox";
  else if (/chrome\//i.test(ua)) browser = "chrome";
  else if (/safari\//i.test(ua)) browser = "safari";

  let device: DeviceType = "desktop";
  if (/ipad|tablet/i.test(ua)) device = "tablet";
  else if (/mobi|iphone|android/i.test(ua)) device = "mobile";
  else if (/macintosh/i.test(ua)) device = "laptop";

  let os = "unknown";
  if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { browser, device, os };
}
