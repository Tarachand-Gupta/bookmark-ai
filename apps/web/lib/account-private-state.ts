/** Private draft cleanup is explicit-user intent, separate from auth expiry. */
export const PRIVATE_SIGN_OUT_EVENT = "bookmark-explicit-sign-out";
export const PRIVATE_SIGN_OUT_STORAGE = "bmai:explicit-sign-out:v1";
const privatePrefixes = ["bmai:composer:v1:", "bmai:organization-batches:v1:", "bmai:organization-request:v1:", "bmai:save-request:v1:"];
export function clearAccountPrivateStorage(storage: Pick<Storage, "removeItem">, accountId: string) {
  for (const prefix of privatePrefixes) { try { storage.removeItem(`${prefix}${accountId}`); } catch { /* Private memory is still cleared. */ } }
}
export function announceExplicitSignOut(accountId: string) {
  const signal = { accountId, nonce: crypto.randomUUID() };
  try { clearAccountPrivateStorage(localStorage, accountId); localStorage.setItem(PRIVATE_SIGN_OUT_STORAGE, JSON.stringify(signal)); } catch { /* Restricted storage. */ }
  window.dispatchEvent(new CustomEvent(PRIVATE_SIGN_OUT_EVENT, { detail: signal }));
  try { const channel = new BroadcastChannel(PRIVATE_SIGN_OUT_EVENT); channel.postMessage(signal); channel.close(); } catch { /* Storage event remains the cross-tab fallback. */ }
}
export function onExplicitSignOut(accountId: string, clear: () => void) {
  let cleared = false;
  const receive = (value: unknown) => {
    if (!cleared && value && typeof value === "object" && "accountId" in value && value.accountId === accountId) { cleared = true; clear(); }
  };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  const storage = (event: StorageEvent) => { if (event.key === PRIVATE_SIGN_OUT_STORAGE) { try { receive(JSON.parse(event.newValue ?? "null")); } catch { /* Ignore malformed unrelated state. */ } } };
  window.addEventListener(PRIVATE_SIGN_OUT_EVENT, local); window.addEventListener("storage", storage);
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(PRIVATE_SIGN_OUT_EVENT); channel.onmessage = event => receive(event.data); } catch { /* Optional API. */ }
  return () => { window.removeEventListener(PRIVATE_SIGN_OUT_EVENT, local); window.removeEventListener("storage", storage); channel?.close(); };
}
