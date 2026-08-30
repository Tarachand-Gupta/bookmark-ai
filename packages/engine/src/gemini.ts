/** Thin Gemini REST client — no SDK dependency needed for two endpoints. */

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const GENERATION_MODEL = "gemini-2.5-flash";
const EMBEDDING_MODEL = "gemini-embedding-001";

export class GeminiClient {
  constructor(private readonly apiKey: string) {}

  /** Generate a JSON object constrained by `responseSchema`. */
  async generateJson<T>(prompt: string, responseSchema: object): Promise<T> {
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
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text) as T;
  }

  /**
   * Web search via Gemini's built-in Google Search grounding: one flash call
   * with the `google_search` tool, returning the grounded answer plus the
   * cited sources. Works from any egress IP (it's a Google API call), unlike
   * the DuckDuckGo scrape in web-tools.ts, which datacenter IPs get blocked
   * from — this is the chat agent's primary webSearch backend.
   */
  async groundedSearch(query: string): Promise<GroundedSearch> {
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
    return parseGroundedSearch(await res.json());
  }

  /**
   * Embed text at a reduced dimensionality. Gemini only pre-normalizes
   * 3072-dim vectors, so reduced vectors are re-normalized here — cosine
   * distance in libSQL then behaves as similarity.
   */
  async embed(text: string, dimensions: number): Promise<number[]> {
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
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const values = data.embedding?.values;
    if (!values || values.length !== dimensions) {
      throw new Error(`Gemini embedding has unexpected shape (${values?.length ?? 0})`);
    }
    return normalize(values);
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
