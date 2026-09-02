import { childObservation } from "./tracing";

/** Thin Gemini REST client — no SDK dependency needed for two endpoints. */

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const GENERATION_MODEL = "gemini-2.5-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";

/** Cap what a traced prompt/answer contributes to an observation — the trace
 * is for debugging, not archival, and a 500-tab prompt is pure noise past this. */
const TRACE_PROMPT_MAX = 8_000;
const TRACE_ANSWER_MAX = 2_000;

/** The REST responses' token accounting, previously discarded. */
interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

/** Map Gemini's usageMetadata to Langfuse usageDetails; undefined when absent
 * (embedContent, for one, may not report usage). */
function usageDetailsOf(u: UsageMetadata | undefined): Record<string, number> | undefined {
  const details: Record<string, number> = {};
  if (typeof u?.promptTokenCount === "number") details.input = u.promptTokenCount;
  if (typeof u?.candidatesTokenCount === "number") details.output = u.candidatesTokenCount;
  return Object.keys(details).length > 0 ? details : undefined;
}

function truncateForTrace(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export class GeminiClient {
  constructor(private readonly apiKey: string) {}

  /** Generate a JSON object constrained by `responseSchema`. */
  async generateJson<T>(prompt: string, responseSchema: object): Promise<T> {
    // Child generation only when a feature-level trace is already active —
    // see childObservation. Purely additive: fetch/timeout/error semantics of
    // the call itself are untouched.
    const obs = childObservation("gemini-generate-json", "generation", {
      model: GENERATION_MODEL,
      input: truncateForTrace(prompt, TRACE_PROMPT_MAX),
    });
    try {
      const res = await fetch(`${BASE}/models/${GENERATION_MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Gemini generateContent ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: UsageMetadata;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini returned no content");
      const parsed = JSON.parse(text) as T;
      obs?.update({ output: parsed, usageDetails: usageDetailsOf(data.usageMetadata) });
      return parsed;
    } catch (err) {
      obs?.update({ level: "ERROR", statusMessage: (err as Error).message });
      throw err;
    } finally {
      obs?.end();
    }
  }

  /**
   * Web search via Gemini's built-in Google Search grounding: one flash call
   * with the `google_search` tool, returning the grounded answer plus the
   * cited sources. Works from any egress IP (it's a Google API call), unlike
   * the DuckDuckGo scrape in web-tools.ts, which datacenter IPs get blocked
   * from — this is the chat agent's primary webSearch backend.
   */
  async groundedSearch(query: string): Promise<GroundedSearch> {
    const obs = childObservation("gemini-grounded-search", "generation", {
      model: GENERATION_MODEL,
      input: query,
    });
    try {
      const res = await fetch(`${BASE}/models/${GENERATION_MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Search the web and answer concisely from the results: ${query.slice(0, 2_000)}`,
                },
              ],
            },
          ],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0 },
        }),
        // The chat agent's tools guard themselves at ~10s; grounding does its own
        // search round-trip, so give it a little more headroom.
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Gemini groundedSearch ${res.status}: ${await res.text()}`);
      const data: unknown = await res.json();
      const parsed = parseGroundedSearch(data);
      obs?.update({
        output: {
          answer: truncateForTrace(parsed.answer, TRACE_ANSWER_MAX),
          sourceCount: parsed.sources.length,
        },
        usageDetails: usageDetailsOf(
          (data as { usageMetadata?: UsageMetadata } | null)?.usageMetadata,
        ),
      });
      return parsed;
    } catch (err) {
      obs?.update({ level: "ERROR", statusMessage: (err as Error).message });
      throw err;
    } finally {
      obs?.end();
    }
  }

  /**
   * Embed text at a reduced dimensionality. Gemini only pre-normalizes
   * 3072-dim vectors, so reduced vectors are re-normalized here — cosine
   * distance in libSQL then behaves as similarity.
   */
  async embed(text: string, dimensions: number): Promise<number[]> {
    // Output deliberately omitted from the trace — a 768-float vector is noise.
    const obs = childObservation("gemini-embed", "embedding", {
      model: EMBEDDING_MODEL,
      input: { length: text.length, preview: text.slice(0, 200) },
    });
    try {
      const res = await fetch(`${BASE}/models/${EMBEDDING_MODEL}:embedContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8_000) }] },
          outputDimensionality: dimensions,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Gemini embedContent ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        embedding?: { values?: number[] };
        usageMetadata?: UsageMetadata;
      };
      const values = data.embedding?.values;
      if (!values || values.length !== dimensions) {
        throw new Error(`Gemini embedding has unexpected shape (${values?.length ?? 0})`);
      }
      // embedContent may not report usage — update only when it did.
      const usageDetails = usageDetailsOf(data.usageMetadata);
      if (usageDetails) obs?.update({ usageDetails });
      return normalize(values);
    } catch (err) {
      obs?.update({ level: "ERROR", statusMessage: (err as Error).message });
      throw err;
    } finally {
      obs?.end();
    }
  }
}

/** A grounded-search outcome: the model's answer plus its cited web sources. */
export interface GroundedSearch {
  /** The synthesized answer text ("" when the model returned none). */
  answer: string;
  /** Cited sources. `uri` is Google's grounding redirect URL; `title` is usually the source domain. */
  sources: { uri: string; title: string }[];
  /** Answer segments attributed to sources, as indices into `sources`. */
  supports: { text: string; sourceIndices: number[] }[];
}

/**
 * Pure mapper over the `generateContent` + `google_search` response shape
 * (candidates[0].groundingMetadata) — exported for tests. Tolerant of every
 * field being absent: an un-grounded reply degrades to `{answer, [], []}`.
 */
export function parseGroundedSearch(data: unknown): GroundedSearch {
  const candidate = (
    data as null | undefined | {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: {
          groundingChunks?: { web?: { uri?: string; title?: string } }[];
          groundingSupports?: {
            segment?: { text?: string };
            groundingChunkIndices?: number[];
          }[];
        };
      }[];
    }
  )?.candidates?.[0];

  const answer = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  // 1:1 with groundingChunks (a chunk with no web uri keeps its slot as "") so
  // the supports' chunk indices stay aligned; consumers filter empties last.
  const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).map((chunk) => ({
    uri: chunk.web?.uri ?? "",
    title: chunk.web?.title ?? "",
  }));

  const supports = (candidate?.groundingMetadata?.groundingSupports ?? []).flatMap((support) => {
    const text = support.segment?.text?.trim();
    if (!text) return [];
    return [{ text, sourceIndices: support.groundingChunkIndices ?? [] }];
  });

  return { answer, sources, supports };
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}
