import { describe, expect, it } from "vitest";
import { parseGroundedSearch } from "@bookmark-ai/engine";

/**
 * Pins the shape of Gemini's `google_search` grounding response — the fixture
 * mirrors a real captured `generateContent` reply (URIs shortened). This is
 * the chat agent's primary webSearch backend; the DDG scrape is only the
 * keyless fallback (Vercel's egress IPs are blocked by DDG).
 */
describe("parseGroundedSearch", () => {
  const fixture = {
    candidates: [
      {
        content: {
          parts: [{ text: "SwiftUI grids improved. " }, { text: "Notably automatic sizing." }],
        },
        finishReason: "STOP",
        groundingMetadata: {
          searchEntryPoint: { renderedContent: "<div>…</div>" },
          groundingChunks: [
            { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "medium.com" } },
            { retrievedContext: {} }, // non-web chunk keeps its slot
            { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB", title: "hackingwithswift.com" } },
          ],
          groundingSupports: [
            {
              segment: { startIndex: 0, endIndex: 23, text: "SwiftUI grids improved." },
              groundingChunkIndices: [0, 2],
            },
            {
              segment: { startIndex: 24, endIndex: 49, text: "Notably automatic sizing." },
              groundingChunkIndices: [2],
            },
          ],
          webSearchQueries: ["swiftui grid improvements"],
        },
      },
    ],
    usageMetadata: { totalTokenCount: 500 },
  };

  it("maps answer, sources, and supports from a real-shaped response", () => {
    const parsed = parseGroundedSearch(fixture);
    expect(parsed.answer).toBe("SwiftUI grids improved. Notably automatic sizing.");
    // Sources stay 1:1 with groundingChunks so support indices keep meaning.
    expect(parsed.sources).toEqual([
      { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "medium.com" },
      { uri: "", title: "" },
      { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB", title: "hackingwithswift.com" },
    ]);
    expect(parsed.supports).toEqual([
      { text: "SwiftUI grids improved.", sourceIndices: [0, 2] },
      { text: "Notably automatic sizing.", sourceIndices: [2] },
    ]);
  });

  it("degrades to empty shapes when the reply is un-grounded or malformed", () => {
    expect(parseGroundedSearch({ candidates: [{ content: { parts: [{ text: "plain" }] } }] })).toEqual({
      answer: "plain",
      sources: [],
      supports: [],
    });
    expect(parseGroundedSearch({})).toEqual({ answer: "", sources: [], supports: [] });
    expect(parseGroundedSearch(null)).toEqual({ answer: "", sources: [], supports: [] });
  });
});
