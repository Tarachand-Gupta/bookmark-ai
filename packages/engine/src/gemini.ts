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

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}
