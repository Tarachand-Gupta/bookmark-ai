import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";

/**
 * The public web pages the app links to. One module so the sign-in consent line
 * and Settings → Legal & Support can never point at different URLs, and so the
 * store listings (which carry the same three) stay in step with the binary.
 *
 * `www` is the canonical host — the apex 308s to it (see PROD_API_URL in
 * ../api). These are the hosted service's pages regardless of SERVER_TARGET: a
 * dev build talking to localhost still shows the real policy, because the policy
 * describes the hosted product the store build ships as.
 */
export const WEB_URL = "https://www.bookmark-ai.cloud";
export const PRIVACY_URL = `${WEB_URL}/privacy`;
export const TERMS_URL = `${WEB_URL}/terms`;
export const SUPPORT_EMAIL = "tara@purecode.ai";

/**
 * Open a web page in the in-app browser sheet (SFSafariViewController / Chrome
 * Custom Tab) so the user lands back where they were when they dismiss it. A
 * refused URL falls through to the system browser; both failing is silent — a
 * legal link must never be able to crash the screen it sits on.
 */
export function openWebPage(url: string): void {
  void WebBrowser.openBrowserAsync(url).catch(() =>
    Linking.openURL(url).catch(() => undefined),
  );
}
