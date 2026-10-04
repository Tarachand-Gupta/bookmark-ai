/** Optional telemetry must never make request startup depend on its configuration. */
export function hasValidLangfuseConfig(env: NodeJS.ProcessEnv): boolean {
  const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey, LANGFUSE_BASE_URL: baseUrl } = env;
  if (!publicKey || !secretKey) return false;
  if ([publicKey, secretKey, baseUrl].some(value => value && /\[(?:SENSITIVE|REDACTED)\]/i.test(value))) return false;
  if (!baseUrl) return true; // SDK's supported default region.
  try {
    const url = new URL(baseUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

export function initializeOptionalTelemetry(initialize: () => void, warn: () => void): void {
  try { initialize(); } catch { warn(); } // Never log exporter errors/credentials.
}
