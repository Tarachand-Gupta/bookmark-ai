import React from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { ClerkProvider } from "@clerk/chrome-extension";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import App from "./App";
import { ClerkBoundary } from "./components/ClerkBoundary";
import { ClerkUnavailable } from "./components/ClerkUnavailable";
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

/**
 * Dark mode. `assets/tailwind.css` declares `@custom-variant dark (&:is(.dark *))`,
 * so every `dark:` utility is gated on a `.dark` class and the built CSS contains
 * NO `prefers-color-scheme` rules — nothing was ever setting that class, which
 * left the popup permanently light and all the dark variants dead.
 *
 * Mirror the OS preference onto `<html>` before the first render, and keep
 * listening: a popup can be open while the system flips at sunset, and Chrome
 * keeps the document alive across that. No storage, no dependency, no in-popup
 * theme setting — the popup follows the OS, same as the extension chrome around it.
 *
 * The popup is the extension's ONLY rendered UI; `background.ts`,
 * `bridge.content.ts`, and `marker.content.ts` render nothing (the content
 * scripts only read/stamp attributes on the host page), so nothing else needs this.
 */
function syncTheme(): void {
  if (typeof window.matchMedia !== "function") return;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
  apply(query.matches);
  query.addEventListener("change", (e) => apply(e.matches));
}
syncTheme();

const EXTENSION_URL = browser.runtime.getURL("/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkBoundary fallback={<ClerkUnavailable />}>
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        syncHost={CLERK_SYNC_HOST}
        afterSignOutUrl={`${EXTENSION_URL}popup.html`}
        signInFallbackRedirectUrl={`${EXTENSION_URL}popup.html`}
        signUpFallbackRedirectUrl={`${EXTENSION_URL}popup.html`}
      >
        <App />
      </ClerkProvider>
    </ClerkBoundary>
  </React.StrictMode>,
);
