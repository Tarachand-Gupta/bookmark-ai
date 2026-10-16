export type ExtensionAuthorizationStatus = "waiting" | "complete" | "failed" | "unavailable";
export const extensionAuthorizationText: Record<ExtensionAuthorizationStatus, string> = {
  waiting: "Completing extension authorization…",
  complete: "Extension connected. You can close this tab.",
  failed: "Authorization failed. Start again from the extension.",
  unavailable: "The extension has not confirmed the connection. Open its popup to check your sign-in.",
};

/** This handshake controls display only. The extension validates the callback. */
export function observeExtensionAuthorization(
  target: EventTarget,
  update: (status: ExtensionAuthorizationStatus) => void,
): () => void {
  const timer = setTimeout(() => update("unavailable"), 10000);
  const receive = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (detail !== "complete" && detail !== "failed" && detail !== "unavailable") return;
    clearTimeout(timer);
    update(detail);
  };
  target.addEventListener("bookmark-extension-authorization", receive);
  target.dispatchEvent(new Event("bookmark-extension-authorization-ready"));
  return () => {
    clearTimeout(timer);
    target.removeEventListener("bookmark-extension-authorization", receive);
  };
}
