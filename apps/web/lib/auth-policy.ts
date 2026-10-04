export function safeAuthDestination(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value))
    return fallback;
  try {
    const url = new URL(value, "https://bookmark.invalid");
    return url.origin === "https://bookmark.invalid"
      ? url.pathname + url.search + url.hash
      : fallback;
  } catch {
    return fallback;
  }
}
/** Share the same local return destination across email, OAuth, and auth-page links. */
export function authDestinationFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  return safeAuthDestination(params.get("next") ?? params.get("redirect_url"));
}
export function displayName(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 80)
    : "";
}

/** full_name is canonical across clients; display_name supports earlier QA metadata. */
export function profileName(metadata: Record<string, unknown> | undefined): string {
  return displayName(metadata?.full_name) || displayName(metadata?.display_name);
}
export function profileNameUpdate(value: unknown) {
  const name = displayName(value);
  return { full_name: name, display_name: name };
}
