import { browser } from "wxt/browser";

/** Build-target attribution; Chromium variants share the Chrome extension. */
export async function analyticsHeaders(): Promise<Record<string, string>> {
  const target = import.meta.env.BROWSER;
  if (target !== "firefox") {
    return { "X-Bookmark-Client": target === "safari" ? "extension-safari" : "extension-chrome" };
  }
  // Read every request so removing consent in about:addons takes effect without
  // a restart. Missing API support/errors fail closed, without blocking saves.
  let granted = false;
  try {
    const permissions = await browser.permissions.getAll() as { data_collection?: string[] };
    granted = permissions.data_collection?.includes("technicalAndInteraction") === true;
  } catch { /* collection remains disabled */ }
  return {
    "X-Bookmark-Client": "extension-firefox",
    "X-Bookmark-Analytics-Consent": granted ? "granted" : "denied",
  };
}

/** Avoid extra CORS headers on the separate, possibly user-hosted live server. */
export function isMainApiRequest(url: string, apiBase: string): boolean {
  try {
    const request = new URL(url);
    return request.origin === new URL(apiBase).origin && request.pathname.startsWith("/api/");
  } catch { return false; }
}
