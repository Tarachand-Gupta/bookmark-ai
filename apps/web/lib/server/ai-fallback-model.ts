import type { LanguageModel } from "ai";

/**
 * PRIMARY → FALLBACK language model wrapper for the INCLUDED (free) tier.
 *
 * The included AI runs on OpenRouter (GLM) with Gemini behind it: if OpenRouter
 * is unreachable, rate-limited, out of credit, mis-keyed or simply slow to say
 * anything, the user must still get an answer — never an error toast. This wraps
 * two AI SDK models as ONE model that:
 *
 *  - `doGenerate`: runs the primary, and on ANY throw re-runs the fallback.
 *  - `doStream`: runs the primary, then PEEKS the head of its stream. Leading
 *    bookkeeping parts (`stream-start`, `response-metadata`) are buffered; the
 *    first part that carries meaning decides. An immediate `error` part, a throw,
 *    or nothing at all within `firstChunkTimeoutMs` switches to the fallback with
 *    no bytes yet delivered to the client. Once real content has flowed we are
 *    committed — a mid-stream failure surfaces as it always did, because
 *    re-running the turn would duplicate text the user already saw.
 *
 * `onFallback` reports which model actually answered so the route can set the
 * `X-Ai-Model-Tier` header. Pure plumbing, no provider knowledge — unit-tested
 * with fake models in ai-fallback-model.test.ts.
 */

/** Parts that carry no content, so they can be buffered while we decide. */
const NEUTRAL_PART_TYPES = new Set(["stream-start", "response-metadata"]);

/** How long the primary gets to emit its first meaningful part. */
export const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 20_000;

export interface FallbackModelOptions {
  firstChunkTimeoutMs?: number;
  /** Called with `"fallback"` the moment the secondary model takes over. */
  onFallback?: (reason: string) => void;
  /**
   * Called ONCE, as soon as the wrapper knows which half is answering — with
   * `"primary"` when the primary's first meaningful part arrives, `"fallback"`
   * when it doesn't. The route awaits this so `X-Ai-Model-Tier` is truthful
   * rather than optimistic (response headers are flushed before the body).
   */
  onDecision?: (tier: "primary" | "fallback") => void;
}

// The AI SDK's LanguageModel union is wide and version-specific; this module
// only ever forwards call options and results, so it works against the minimal
// structural shape both providers implement (specification v4 today).
type ModelLike = {
  specificationVersion: string;
  provider: string;
  modelId: string;
  supportedUrls: unknown;
  doGenerate(options: unknown): PromiseLike<unknown>;
  doStream(options: unknown): PromiseLike<{ stream: ReadableStream<StreamPart>; [k: string]: unknown }>;
};

type StreamPart = { type: string; [k: string]: unknown };

function timeout(ms: number): { promise: Promise<never>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`primary model produced nothing in ${ms}ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Read the head of `stream` until a meaningful part appears. Returns the parts
 * consumed so far plus the live reader, or `null` when the head is an error (or
 * the read throws / times out) — the signal to abandon this model.
 */
async function peekHead(
  stream: ReadableStream<StreamPart>,
  timeoutMs: number,
): Promise<
  | { buffered: StreamPart[]; reader: ReadableStreamDefaultReader<StreamPart>; done: boolean }
  | { failure: string; reader: ReadableStreamDefaultReader<StreamPart> }
> {
  const reader = stream.getReader();
  const buffered: StreamPart[] = [];
  const t = timeout(timeoutMs);
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), t.promise]);
      if (done) return { buffered, reader, done: true };
      if (!value) continue;
      if (value.type === "error") {
        return { failure: describeErrorPart(value), reader };
      }
      buffered.push(value);
      if (!NEUTRAL_PART_TYPES.has(value.type)) return { buffered, reader, done: false };
    }
  } catch (err) {
    return { failure: (err as Error).message, reader };
  } finally {
    t.cancel();
  }
}

function describeErrorPart(part: StreamPart): string {
  const e = part.error;
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "the model returned an error part";
}

/** Re-assemble a stream from the parts already read plus whatever is left. */
function resume(buffered: StreamPart[], reader: ReadableStreamDefaultReader<StreamPart>, finished: boolean): ReadableStream<StreamPart> {
  return new ReadableStream<StreamPart>({
    start(controller) {
      for (const part of buffered) controller.enqueue(part);
      if (finished) controller.close();
    },
    async pull(controller) {
      if (finished) return;
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * One model that is `primary` when it works and `fallback` when it doesn't.
 * The wrapper reports the PRIMARY's provider/modelId (that's what a caller asked
 * for); `onFallback` is the authoritative signal that the other one answered.
 */
export function withModelFallback(
  primary: LanguageModel,
  fallback: LanguageModel,
  { firstChunkTimeoutMs = DEFAULT_FIRST_CHUNK_TIMEOUT_MS, onFallback, onDecision }: FallbackModelOptions = {},
): LanguageModel {
  const p = primary as unknown as ModelLike;
  const f = fallback as unknown as ModelLike;

  const model: ModelLike = {
    specificationVersion: p.specificationVersion,
    provider: p.provider,
    modelId: p.modelId,
    supportedUrls: p.supportedUrls,

    async doGenerate(options) {
      try {
        const out = await p.doGenerate(options);
        onDecision?.("primary");
        return out;
      } catch (err) {
        onFallback?.((err as Error).message);
        onDecision?.("fallback");
        return await f.doGenerate(options);
      }
    },

    async doStream(options) {
      let head: Awaited<ReturnType<typeof peekHead>> | { failure: string; reader?: undefined };
      let result: Awaited<ReturnType<ModelLike["doStream"]>> | null = null;
      try {
        result = await p.doStream(options);
        head = await peekHead(result.stream, firstChunkTimeoutMs);
      } catch (err) {
        head = { failure: (err as Error).message };
      }

      if ("failure" in head) {
        onFallback?.(head.failure);
        onDecision?.("fallback");
        // Best-effort: release the primary's stream (the reader owns it) before
        // switching, so an aborted OpenRouter call doesn't linger.
        try {
          await head.reader?.cancel(head.failure);
        } catch {
          // The provider may already have torn the stream down — nothing to do.
        }
        return await f.doStream(options);
      }
      onDecision?.("primary");
      const ok = head as { buffered: StreamPart[]; reader: ReadableStreamDefaultReader<StreamPart>; done: boolean };
      return { ...(result as object), stream: resume(ok.buffered, ok.reader, ok.done) } as Awaited<
        ReturnType<ModelLike["doStream"]>
      >;
    },
  };

  return model as unknown as LanguageModel;
}
