/** Authorization details can consume an already-approved provider request.
 * Repeated effect subscriptions must share its result, including redirect_url. */
export function createConsentRequest<T>(load: (authorizationId: string) => Promise<T>) {
  let pending: { key: string; request: Promise<T> } | undefined;
  return (authorizationId: string, accountId: string) => {
    const key = `${accountId}:${authorizationId}`;
    if (pending?.key !== key) pending = { key, request: Promise.resolve().then(() => load(authorizationId)) };
    return pending.request;
  };
}
