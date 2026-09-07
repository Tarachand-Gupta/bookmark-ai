import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PopupErrorBoundary } from "./components/PopupErrorBoundary";
import { PopupFallback } from "./components/PopupFallback";
import "@/assets/tailwind.css";

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
 * SAFARI needs one more thing, and without it this whole mechanism was dead
 * there: WebKit renders an extension popover in the light appearance — and
 * `matchMedia("(prefers-color-scheme: dark)")` answers `false` inside it — unless
 * the document declares that it supports dark. That declaration is
 * `color-scheme: light dark`, on `:root` in `assets/tailwind.css` and as a
 * `<meta name="color-scheme">` in `index.html` (pinned by `popup-theme.test.ts`);
 * Chrome and Firefox always matched the OS, which is why this looked Safari-only.
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

/*
 * NO Clerk client in the popup — on purpose.
 *
 * The popup used to mount `@clerk/chrome-extension`'s `<ClerkProvider syncHost>`,
 * a leftover from before auth moved into the background. Nothing here consumed
 * it: the sign-in gate is driven by the background's `GET_USER` reply
 * (`use-auth.ts`), sign-out goes through the `SIGN_OUT` message, and the popup
 * hosts no sign-in UI (OAuth can't run in an extension popup). What the provider
 * DID do was (a) ship ~1 MB of clerk-js into the popup bundle on every browser
 * and (b) throw on Firefox: `createClerkClient` validates
 * `runtime.getManifest()` and demands `host_permissions`, an MV3 key that
 * Firefox strips from the normalized MV2 manifest — so every Firefox user saw
 * "Sign-in is unavailable in this browser build" instead of the gate (verified
 * 2026-09-03). The background is now the ONLY `@clerk/chrome-extension`
 * consumer; see `lib/manifest-shim.ts` for how it survives the same check on
 * Firefox. The error boundary stays as a generic guard so a render crash can
 * never blank the popup.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupErrorBoundary fallback={<PopupFallback />}>
      <App />
    </PopupErrorBoundary>
  </React.StrictMode>,
);
