/**
 * The live LangfuseSpanProcessor, shared between the instrumentation-time
 * registration (register.ts writes it) and the routes that flush after AI work
 * (this module reads it). On globalThis because instrumentation.ts and the
 * route handlers live in separate webpack bundles — a module-level variable
 * would be two variables (same reason context.ts stores its caches there).
 */

/** The one method flushing needs — avoids importing @langfuse/otel here. */
interface FlushableProcessor {
  forceFlush(): Promise<void>;
}

const store = globalThis as unknown as {
  __bookmarkLangfuseProcessor?: FlushableProcessor;
};

/** Called once by register.ts after the processor is created. */
export function setObservabilityProcessor(processor: FlushableProcessor): void {
  store.__bookmarkLangfuseProcessor = processor;
}

/**
 * Push any buffered spans to Langfuse NOW. Serverless instances can be frozen
 * or reaped right after the response (and `after()` callbacks) finish, so
 * every route that produced spans awaits this at the end of its deferred
 * work. No-op when observability isn't configured; never throws.
 */
export async function flushObservability(): Promise<void> {
  const processor = store.__bookmarkLangfuseProcessor;
  if (!processor) return;
  try {
    await processor.forceFlush();
  } catch (err) {
    console.warn("[observability] flush failed:", (err as Error).message);
  }
}
