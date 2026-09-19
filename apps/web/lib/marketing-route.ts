export type RootSearchParams = Record<string, string | string[] | undefined>;

/**
 * Signed-in visits to the bare origin normally continue into /app. A marketing
 * link can opt into the public homepage with the exact, case-sensitive
 * `view=website` value; repeated or lookalike values do not suppress the app
 * redirect. All legacy query parameters are otherwise preserved verbatim.
 */
export function signedInRootDestination(params: RootSearchParams): string | null {
  if (params.view === "website") return null;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value != null) query.set(key, value);
  }

  const serialized = query.toString();
  return serialized ? `/app?${serialized}` : "/app";
}
