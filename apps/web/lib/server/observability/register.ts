import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { registerTelemetry } from "ai";
import { setTracingGate } from "@bookmark-ai/engine";
import { isSurfaceEnabled } from "@/lib/server/observability/config";
import { setObservabilityProcessor } from "@/lib/server/observability/flush";

/**
 * Langfuse observability wiring, imported once from instrumentation.ts (Node
 * runtime only). With LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY set (root
 * .env, loaded by next.config.ts's loader) this:
 *
 *  1. creates the LangfuseSpanProcessor (with a secret-redacting mask) on a
 *     dedicated NodeTracerProvider,
 *  2. hands that provider to `@langfuse/tracing` via setLangfuseTracerProvider
 *     — deliberately NOT `provider.register()`: registering the GLOBAL trace
 *     provider would wake Next's own built-in request tracing and flood
 *     Langfuse with framework noise spans. Only spans our code (and the AI
 *     SDK integration below) creates ever reach the processor,
 *  3. registers the global context manager so active-span propagation works
 *     (that part IS global — it's how a Gemini call inside a tool finds the
 *     tool's span; harmless on its own, context is inert without spans),
 *  4. registers the AI SDK v7 telemetry integration (chat traces), pointed at
 *     the same dedicated provider,
 *  5. installs the engine's tracing gate → the admin-adjustable per-surface
 *     config.
 *
 * Without the keys none of this runs: the gate stays off, `traced()` is a
 * passthrough, and flushObservability() is a no-op.
 *
 * Guarded against double-registration (dev HMR re-runs instrumentation, and
 * route bundles may import this module separately) via a globalThis flag,
 * exactly like context.ts guards its caches.
 */

const store = globalThis as unknown as {
  __bookmarkObservabilityRegistered?: boolean;
};

/** Secret shapes that must never reach a trace, wherever they appear. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI/Anthropic/Langfuse secret keys
  /\bpk-lf-[A-Za-z0-9-]{8,}/g, // Langfuse public keys
  /\benc:v1:[A-Za-z0-9+/=]+(?::[A-Za-z0-9+/=]+)*/g, // our AES-GCM key envelopes
  /\bAIza[A-Za-z0-9_-]{10,}/g, // Google API keys
];

function redactString(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

/** Redact recursively — masked data may be a string OR structured. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (depth >= 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactSecrets(v, depth + 1);
  }
  return out;
}

function register(): void {
  if (store.__bookmarkObservabilityRegistered) return;
  store.__bookmarkObservabilityRegistered = true;

  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return; // unconfigured — tracing stays entirely off
  }

  const processor = new LangfuseSpanProcessor({
    mask: ({ data }) => redactSecrets(data),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });

  // Global context manager (span propagation), NOT a global tracer provider —
  // see the module comment for why.
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  setLangfuseTracerProvider(provider);
  // The integration's default tracer comes from the GLOBAL provider (a no-op
  // here by design), so hand it the dedicated one explicitly.
  registerTelemetry(new LangfuseVercelAiSdkIntegration({ tracer: provider.getTracer("gen_ai") }));
  setTracingGate(isSurfaceEnabled);
  setObservabilityProcessor(processor);

  const host = (() => {
    try {
      return process.env.LANGFUSE_BASE_URL ? new URL(process.env.LANGFUSE_BASE_URL).host : "cloud.langfuse.com";
    } catch {
      return "(invalid LANGFUSE_BASE_URL)";
    }
  })();
  console.log(`[observability] Langfuse tracing registered → ${host}`);
}

register();
