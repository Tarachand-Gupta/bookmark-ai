/** React Native's AbortSignal polyfill has no static timeout() method. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
