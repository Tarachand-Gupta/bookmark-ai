import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@/assets/tailwind.css";

// No ClerkProvider here on purpose: page-context Clerk (syncHost) CANNOT see
// the production session (the client token is an HttpOnly cookie on the FAPI
// domain, not the syncHost — see apps/extension CLAUDE.md's native-session
// note). Auth comes from the BACKGROUND instead: the gate polls GET_USER and
// every API call is proxied through the background's auth ladder via the
// API_PROXY message (lib/messages.ts). Same runtime, shared token — the popup
// and this page can never disagree about sign-in state.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
