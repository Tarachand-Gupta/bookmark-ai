import { after } from "next/server";
import {
  analyticsPlatform, captureProductEvent, flushProductAnalytics,
  type ProductEventInput,
} from "@/lib/server/analytics/posthog";

/** Analytics is optional: even unavailable request lifecycle must not break a save. */
export function scheduleProductEvent(request: Request, input: Omit<ProductEventInput, "platform">): void {
  try {
    const event = { ...input, platform: analyticsPlatform(request), properties: { ...input.properties } };
    after(async () => {
      try {
        await captureProductEvent(event);
        await flushProductAnalytics();
      } catch { /* best effort, including during tests with injected failures */ }
    });
  } catch { /* no request scope: skip instead of changing the product response */ }
}

/** One terminal event after stream closure; a later error overrides completion. */
export function trackChatOutcome(request: Request, userId: string | null, aiSource: "included" | "own") {
  const started = performance.now();
  let completed = false;
  let failed = false;
  try {
    const platform = analyticsPlatform(request);
    after(async () => {
      try {
        const success = completed && !failed;
        await captureProductEvent({
          event: success ? "chat_response_completed" : "chat_response_failed",
          userId, platform,
          properties: { ai_source: aiSource, outcome: success ? "success" : "failure", duration_ms: performance.now() - started },
        });
        await flushProductAnalytics();
      } catch { /* product behavior never depends on analytics */ }
    });
  } catch { /* unavailable lifecycle: analytics stays disabled */ }
  return {
    complete: ({ isAborted = false }: { isAborted?: boolean } = {}) => {
      // SDK onEnd can include meaningful partial content after cancellation.
      if (isAborted) failed = true;
      else completed = true;
    },
    fail: () => { failed = true; },
  };
}
