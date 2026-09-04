import type { ChatAiSource } from "@bookmark-ai/types";

/**
 * Turn a mid-stream failure (the provider rejecting an own key, a 429, a
 * timeout, a model that doesn't exist) into the readable `error` chunk the
 * client renders — instead of the SDK's default "An error occurred." and a
 * blank assistant turn. Never leaks a credential: the provider's message is
 * redacted and truncated before it is quoted.
 */

const MAX_DETAIL = 160;

/** Key-looking tokens and `?key=` params → `[redacted]`. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:sk|rk|AIza|ghp|gho|xox[a-z]|bkd|bkmcp)[-_A-Za-z0-9]{8,}/g, "[redacted]")
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]");
}

interface ErrorLike {
  name?: string;
  message?: string;
  statusCode?: number;
  responseBody?: unknown;
  lastError?: unknown;
  cause?: unknown;
}

/** RetryError wraps the last attempt; `cause` chains are common too. */
function unwrap(error: unknown, depth = 0): ErrorLike {
  if (!error || typeof error !== "object" || depth > 4) return {};
  const e = error as ErrorLike;
  if (e.lastError && typeof e.lastError === "object") return unwrap(e.lastError, depth + 1);
  if (typeof e.statusCode !== "number" && e.cause && typeof e.cause === "object") {
    const inner = unwrap(e.cause, depth + 1);
    if (typeof inner.statusCode === "number") return inner;
  }
  return e;
}

/** The provider's own explanation, if the response body carries one. */
function providerDetail(e: ErrorLike): string {
  let text = "";
  if (typeof e.responseBody === "string") {
    try {
      const parsed = JSON.parse(e.responseBody) as { error?: { message?: unknown } | string; message?: unknown };
      const msg =
        typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.error?.message === "string"
            ? parsed.error.message
            : typeof parsed.message === "string"
              ? parsed.message
              : "";
      text = msg;
    } catch {
      text = "";
    }
  }
  text = redactSecrets(text.replace(/\s+/g, " ").trim());
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

export function describeChatError(error: unknown, source: ChatAiSource = "included"): string {
  const who = source === "included" ? "The included AI" : "Your AI provider";
  const fix = source === "included" ? "Try again in a moment." : "Check Settings → AI.";
  const e = unwrap(error);
  const name = typeof e.name === "string" ? e.name : "";
  const message = redactSecrets(typeof e.message === "string" ? e.message : String(error ?? ""));
  const detail = providerDetail(e);
  const withDetail = (base: string) => (detail ? `${base} (${detail})` : base);

  if (typeof e.statusCode === "number") {
    const s = e.statusCode;
    if (s === 401 || s === 403) return withDetail(`${who} rejected the API key (HTTP ${s}). ${source === "included" ? fix : "Check the key in Settings → AI."}`);
    if (s === 404) return withDetail(`${who} couldn't find that model (HTTP 404). ${source === "included" ? fix : "Pick another model in Settings → AI."}`);
    if (s === 429) return withDetail(`${who} is rate-limiting requests (HTTP 429). Try again in a moment.`);
    if (s === 402) return withDetail(`${who} reports the account is out of credit (HTTP 402). ${fix}`);
    if (s >= 500) return withDetail(`${who} is having trouble (HTTP ${s}). Try again shortly.`);
    return withDetail(`${who} returned HTTP ${s}. ${fix}`);
  }
  if (name === "AbortError" || name === "TimeoutError" || /timed?\s?out|timeout/i.test(message)) {
    return `${who} took too long to answer. Try again.`;
  }
  if (name === "AI_LoadAPIKeyError") return "No API key is configured for this provider. Add one in Settings → AI.";
  const short = message.replace(/\s+/g, " ").trim();
  return `The AI request failed: ${short ? (short.length > MAX_DETAIL ? `${short.slice(0, MAX_DETAIL - 1)}…` : short) : "unknown error"}. ${fix}`;
}
