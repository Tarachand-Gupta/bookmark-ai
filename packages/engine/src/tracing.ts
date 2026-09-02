import { trace } from "@opentelemetry/api";
import {
  startActiveObservation,
  startObservation,
  type LangfuseGenerationAttributes,
  type LangfuseSpan,
  type StartActiveObservationOpts,
} from "@langfuse/tracing";

/**
 * Langfuse tracing plumbing for the engine's AI call sites.
 *
 * The engine never reads env vars or config (see context.ts's "packages/*
 * never touch process.env" rule), so whether a given AI surface is traced is
 * decided by a GATE the host app installs via `setTracingGate` — the web app
 * wires it to its admin-adjustable observability config at instrumentation
 * time. Engine used standalone never traces: the default gate says no, and
 * with no tracer provider registered every observation is a no-op anyway.
 */

/** The AI surfaces that can be traced, each independently switchable. */
export type TraceSurface = "ask-ai" | "session-summary" | "categorize" | "embed" | "search";

type TracingGate = (surface: TraceSurface) => Promise<boolean>;

/**
 * The gate lives on globalThis, NOT in module scope: Next compiles
 * instrumentation.ts and each route into separate bundles, so this module is
 * instantiated more than once per process — a module-level variable set at
 * instrumentation time would be invisible to the routes (the same reason the
 * web app's context.ts keeps its caches there, and how @langfuse/tracing and
 * the AI SDK store their own registration state).
 */
const store = globalThis as unknown as { __bookmarkAiTracingGate?: TracingGate };

/** Default gate: tracing off (engine used outside the web app never traces). */
const OFF: TracingGate = async () => false;

/** Install the host app's per-surface tracing switch (called once at boot). */
export function setTracingGate(fn: TracingGate): void {
  store.__bookmarkAiTracingGate = fn;
}

/** Is this surface currently traced? Never throws — a broken gate reads as off. */
export async function isSurfaceTraced(surface: TraceSurface): Promise<boolean> {
  try {
    return await (store.__bookmarkAiTracingGate ?? OFF)(surface);
  } catch {
    return false;
  }
}

export interface TracedOptions<T> {
  /** Trace input for the observation (the meaningful arguments, not raw blobs). */
  input?: unknown;
  metadata?: Record<string, unknown>;
  /** Observation type; defaults to a plain span. */
  asType?: "span" | "agent" | "tool" | "chain";
  /** Maps the function's result to the observation's output (omit = no output). */
  output?: (result: T) => unknown;
}

/**
 * Run `fn` inside a Langfuse observation named `name` — but only when the
 * gate says `surface` is traced; otherwise `fn` runs exactly as before, zero
 * overhead beyond the gate check. Errors are recorded on the span (level +
 * status message) and ALWAYS rethrown — tracing never changes behavior.
 */
export async function traced<T>(
  surface: TraceSurface,
  name: string,
  opts: TracedOptions<T>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!(await isSurfaceTraced(surface))) return fn();

  return startActiveObservation(
    name,
    async (span: LangfuseSpan) => {
      if (opts.input !== undefined || opts.metadata !== undefined) {
        span.update({ input: opts.input, metadata: opts.metadata });
      }
      try {
        const result = await fn();
        if (opts.output) span.update({ output: opts.output(result) });
        return result;
      } catch (err) {
        span.update({ level: "ERROR", statusMessage: (err as Error).message });
        throw err;
      }
    },
    // The overloads key on a literal asType; the runtime accepts any of ours.
    { asType: opts.asType ?? "span" } as StartActiveObservationOpts & { asType?: "span" },
  );
}

/** What gemini.ts needs from a child observation: set results, close it. */
export interface ChildObservation {
  update(attributes: LangfuseGenerationAttributes): unknown;
  end(): unknown;
}

/**
 * Start a generation/embedding observation for a raw Gemini REST call — but
 * ONLY when a RECORDING span is already active (a `traced()` feature wrapper,
 * or the chat agent's AI-SDK integration span around a tool call). With no
 * active recording span this returns null and the call runs untraced, which
 * is what keeps the per-surface gates authoritative: a lone Gemini call never
 * opens a trace of its own. `isRecording()` matters — a host framework (e.g.
 * Next's built-in tracer) can park NON-recording spans in context even when
 * only Langfuse's provider is live, and those must not count.
 */
export function childObservation(
  name: string,
  asType: "generation" | "embedding",
  attributes: LangfuseGenerationAttributes,
): ChildObservation | null {
  const active = trace.getActiveSpan();
  if (!active?.isRecording()) return null;
  try {
    return asType === "generation"
      ? startObservation(name, attributes, { asType: "generation" })
      : startObservation(name, attributes, { asType: "embedding" });
  } catch {
    return null; // tracing must never break the call it observes
  }
}
