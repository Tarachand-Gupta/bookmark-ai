import { isOAuthBridgeCallback } from "./oauth-policy";

/** Readiness admits only this extension's content script in the hosted callback
 * document. The background separately checks the persisted pending tab binding. */
export function isOAuthCallbackReadySender(
  sender: { id?: string; url?: string; tab?: { id?: number } },
  extensionId: string,
  app: string,
): boolean {
  return sender.id === extensionId &&
    typeof sender.tab?.id === "number" &&
    typeof sender.url === "string" &&
    isOAuthBridgeCallback(sender.url, app);
}
