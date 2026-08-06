import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { ClerkProvider, useAuth } from "@clerk/chrome-extension";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import { setAuthTokenProvider } from "@/lib/api";
import App from "./App";
import { ClerkBoundary } from "../popup/components/ClerkBoundary";
import { ClerkUnavailable } from "../popup/components/ClerkUnavailable";
import "@/assets/tailwind.css";

// Same known-warning filter as the popup (dev Clerk keys warning surfaces on
// the extension's Errors page and reads as a bug).
const CLERK_DEV_KEYS_WARNING = "Clerk has been loaded with development keys";
for (const level of ["warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes(CLERK_DEV_KEYS_WARNING)) return;
    original(...args);
  };
}

const EXTENSION_URL = browser.runtime.getURL("/");

/**
 * Registers the PAGE-context auth for lib/api.ts: unlike the popup (which
 * delegates to the background worker), the new tab is a full extension page
 * hosting its own ClerkProvider, so useAuth().getToken() yields the session
 * JWT directly. Every /api/* call (templates, wizard, chat, bridge reads) goes
 * out as that signed-in user. Signed out → getToken resolves null → 401s,
 * which the App turns into the SignInGate.
 */
function AuthProviderBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenProvider(() => getToken().catch(() => null));
  }, [getToken]);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkBoundary fallback={<ClerkUnavailable />}>
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        syncHost={CLERK_SYNC_HOST}
        afterSignOutUrl={`${EXTENSION_URL}newtab.html`}
        signInFallbackRedirectUrl={`${EXTENSION_URL}newtab.html`}
        signUpFallbackRedirectUrl={`${EXTENSION_URL}newtab.html`}
      >
        <AuthProviderBridge />
        <App />
      </ClerkProvider>
    </ClerkBoundary>
  </React.StrictMode>,
);
