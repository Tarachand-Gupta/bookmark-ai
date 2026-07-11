import React from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { ClerkProvider } from "@clerk/chrome-extension";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import App from "./App";
import "@/assets/tailwind.css";

// Clerk always warns when running on development keys, and Chrome surfaces
// every popup console.warn/error on the extension's Errors page — which reads
// as a bug when it's just the (intentional) dev instance. Drop that one known
// message; a production Clerk instance removes it for real.
const CLERK_DEV_KEYS_WARNING = "Clerk has been loaded with development keys";
for (const level of ["warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes(CLERK_DEV_KEYS_WARNING)) return;
    original(...args);
  };
}

const EXTENSION_URL = browser.runtime.getURL("/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      syncHost={CLERK_SYNC_HOST}
      afterSignOutUrl={`${EXTENSION_URL}popup.html`}
      signInFallbackRedirectUrl={`${EXTENSION_URL}popup.html`}
      signUpFallbackRedirectUrl={`${EXTENSION_URL}popup.html`}
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>,
);
