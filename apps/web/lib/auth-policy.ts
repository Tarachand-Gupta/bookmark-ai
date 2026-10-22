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

/** full_name is canonical; older clients and OAuth providers use the fallback fields. */
export function profileName(metadata: Record<string, unknown> | undefined): string {
  return (
    displayName(metadata?.full_name) ||
    displayName(metadata?.display_name) ||
    displayName(metadata?.name)
  );
}
export function profileNameUpdate(value: unknown) {
  const name = displayName(value);
  return { full_name: name, display_name: name };
}

/** Display-only provider metadata, never an authorization signal. */
export function profileImage(metadata: Record<string, unknown> | undefined): string | null {
  for (const candidate of [metadata?.avatar_url, metadata?.picture]) {
    if (typeof candidate !== "string" || /[\u0000-\u0020\u007f\\]/.test(candidate)) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && url.hostname && !url.username && !url.password)
        return url.href;
    } catch {
      /* Try the provider fallback. */
    }
  }
  return null;
}
