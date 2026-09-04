import { describe, expect, it } from "vitest";
import { describeChatError, redactSecrets } from "./chat-errors";

/** Shape of the AI SDK's APICallError (name/statusCode/responseBody) and RetryError (lastError). */
const apiError = (statusCode: number, body?: unknown, message = `HTTP ${statusCode}`) =>
  Object.assign(new Error(message), {
    name: "AI_APICallError",
    statusCode,
    responseBody: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

describe("describeChatError", () => {
  it("maps an invalid own key (401) to a Settings hint with the provider's detail, redacted", () => {
    const msg = describeChatError(
      apiError(401, { error: { message: "Incorrect API key provided: sk-test-1234567890abcdef. You can find your key at platform.openai.com" } }),
      "own",
    );
    expect(msg).toContain("Your AI provider rejected the API key (HTTP 401)");
    expect(msg).toContain("Check the key in Settings → AI.");
    expect(msg).toContain("Incorrect API key provided: [redacted]");
    expect(msg).not.toContain("sk-test-1234567890abcdef");
  });

  it("speaks about 'the included AI' for the server key and never suggests Settings for it", () => {
    const msg = describeChatError(apiError(429), "included");
    expect(msg).toContain("The included AI is rate-limiting requests (HTTP 429)");
    expect(msg).not.toContain("Settings");
  });

  it("covers 404 (model), 402 (credit), 5xx and other statuses", () => {
    expect(describeChatError(apiError(404), "own")).toContain("couldn't find that model (HTTP 404). Pick another model in Settings → AI.");
    expect(describeChatError(apiError(402), "own")).toContain("out of credit (HTTP 402)");
    expect(describeChatError(apiError(503), "own")).toContain("having trouble (HTTP 503)");
    expect(describeChatError(apiError(418), "own")).toContain("returned HTTP 418");
  });

  it("unwraps a RetryError to its last attempt", () => {
    const retry = Object.assign(new Error("Failed after 3 attempts"), {
      name: "AI_RetryError",
      lastError: apiError(403, { error: "forbidden" }),
    });
    expect(describeChatError(retry, "own")).toContain("rejected the API key (HTTP 403)");
    expect(describeChatError(retry, "own")).toContain("(forbidden)");
  });

  it("timeouts, missing keys and unknown errors are readable and truncated", () => {
    expect(describeChatError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))).toContain("took too long to answer");
    expect(describeChatError(new Error("Request timed out after 50000ms"))).toContain("took too long to answer");
    expect(describeChatError(Object.assign(new Error("x"), { name: "AI_LoadAPIKeyError" }))).toContain("No API key is configured");
    const long = describeChatError(new Error("boom ".repeat(100)), "own");
    expect(long.startsWith("The AI request failed: boom")).toBe(true);
    expect(long.length).toBeLessThan(220);
    expect(describeChatError(undefined)).toContain("unknown error");
  });
});

describe("redactSecrets", () => {
  it("masks key-looking tokens, query params and bearer values", () => {
    expect(redactSecrets("key sk-abcdefghijklmnop rest")).toBe("key [redacted] rest");
    expect(redactSecrets("https://api.example.com/v1?key=AIzaSyABCDEFGHIJK&x=1")).toBe("https://api.example.com/v1?key=[redacted]&x=1");
    expect(redactSecrets("Authorization: Bearer abcdefgh.ijklmnop")).toBe("Authorization: Bearer [redacted]");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});
