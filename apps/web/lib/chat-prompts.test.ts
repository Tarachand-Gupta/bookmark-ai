import { describe, expect, it } from "vitest";
import {
  CHAT_SAMPLE_PROMPTS,
  SAMPLE_PROMPT_VISIBLE,
  nextPromptOffset,
  promptWindow,
  shufflePrompts,
} from "./chat-prompts";

describe("CHAT_SAMPLE_PROMPTS", () => {
  it("has at least 12 prompts, a whole number of pages, and unique ids", () => {
    expect(CHAT_SAMPLE_PROMPTS.length).toBeGreaterThanOrEqual(12);
    // A multiple of the window size means no page ever repeats a card.
    expect(CHAT_SAMPLE_PROMPTS.length % SAMPLE_PROMPT_VISIBLE).toBe(0);
    const ids = new Set(CHAT_SAMPLE_PROMPTS.map((p) => p.id));
    expect(ids.size).toBe(CHAT_SAMPLE_PROMPTS.length);
    const texts = new Set(CHAT_SAMPLE_PROMPTS.map((p) => p.text));
    expect(texts.size).toBe(CHAT_SAMPLE_PROMPTS.length);
  });

  it("keeps every prompt short enough to read on a card", () => {
    for (const p of CHAT_SAMPLE_PROMPTS) {
      expect(p.text.length).toBeLessThanOrEqual(60);
      expect(p.text.trim()).toBe(p.text);
    }
  });
});

describe("promptWindow", () => {
  const pool = [1, 2, 3, 4, 5, 6];

  it("returns exactly `count` items from the offset", () => {
    expect(promptWindow(pool, 0, 4)).toEqual([1, 2, 3, 4]);
    expect(promptWindow(pool, 2, 4)).toEqual([3, 4, 5, 6]);
  });

  it("wraps around the end without repeating within a window", () => {
    const w = promptWindow(pool, 4, 4);
    expect(w).toEqual([5, 6, 1, 2]);
    expect(new Set(w).size).toBe(4);
  });

  it("normalizes out-of-range and negative offsets", () => {
    expect(promptWindow(pool, 6, 4)).toEqual([1, 2, 3, 4]);
    expect(promptWindow(pool, 8, 4)).toEqual([3, 4, 5, 6]);
    expect(promptWindow(pool, -2, 4)).toEqual([5, 6, 1, 2]);
  });

  it("degrades safely on tiny or empty pools", () => {
    expect(promptWindow([1, 2], 0, 4)).toEqual([1, 2]);
    expect(promptWindow([1, 2, 3, 4], 1, 4)).toEqual([1, 2, 3, 4]);
    expect(promptWindow([], 3, 4)).toEqual([]);
    expect(promptWindow(pool, 0, 0)).toEqual([]);
  });

  it("pages the real pool into distinct sets of four that cover it exactly", () => {
    const pages = CHAT_SAMPLE_PROMPTS.length / SAMPLE_PROMPT_VISIBLE;
    const seen: string[] = [];
    let offset = 0;
    for (let i = 0; i < pages; i++) {
      const page = promptWindow(CHAT_SAMPLE_PROMPTS, offset);
      expect(page).toHaveLength(SAMPLE_PROMPT_VISIBLE);
      seen.push(...page.map((p) => p.id));
      offset = nextPromptOffset(offset, CHAT_SAMPLE_PROMPTS.length);
    }
    expect(new Set(seen).size).toBe(CHAT_SAMPLE_PROMPTS.length);
    // One full lap returns to the start.
    expect(offset).toBe(0);
  });
});

describe("nextPromptOffset", () => {
  it("advances a whole page and wraps", () => {
    expect(nextPromptOffset(0, 16, 4)).toBe(4);
    expect(nextPromptOffset(12, 16, 4)).toBe(0);
  });

  it("stays in range for pools that aren't a multiple of the page", () => {
    let offset = 0;
    for (let i = 0; i < 20; i++) {
      offset = nextPromptOffset(offset, 6, 4);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(6);
    }
  });

  it("never divides by an empty pool", () => {
    expect(nextPromptOffset(3, 0, 4)).toBe(0);
  });
});

describe("shufflePrompts", () => {
  it("is a permutation and leaves the source untouched", () => {
    const source = [...CHAT_SAMPLE_PROMPTS];
    // Deterministic "random" so the assertion can't flake.
    let seed = 0.42;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280 / 233280;
      return seed;
    };
    const out = shufflePrompts(CHAT_SAMPLE_PROMPTS, random);
    expect(out).toHaveLength(source.length);
    expect(new Set(out.map((p) => p.id))).toEqual(new Set(source.map((p) => p.id)));
    expect(CHAT_SAMPLE_PROMPTS).toEqual(source);
  });

  it("actually reorders (not an identity function)", () => {
    // random()→0 always picks j=0, so every element is swapped with the head —
    // the one deterministic input that proves the swap loop runs. (random()→~1
    // picks j=i, i.e. a no-op swap, which is why it can't be used here.)
    const out = shufflePrompts(CHAT_SAMPLE_PROMPTS, () => 0);
    expect(out.map((p) => p.id)).not.toEqual(CHAT_SAMPLE_PROMPTS.map((p) => p.id));
  });
});
