import React from "react";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { ClerkProvider } from "@clerk/chrome-extension";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import App from "./App";
import "@/assets/tailwind.css";

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
