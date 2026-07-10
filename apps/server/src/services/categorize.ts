import type { OpenGraph } from "@bookmark-ai/types";
import type { GeminiClient } from "./gemini.js";

/** Curated category vocabulary — keeps the sidebar tidy and predictable. */
export const CATEGORIES = [
  "Development",
  "Design",
  "AI & ML",
  "News",
  "Social",
  "Video",
  "Music",
  "Shopping",
  "Docs & Reference",
  "Productivity",
  "Finance",
  "Entertainment",
  "Science",
  "Travel",
  "Food",
  "Health",
  "Other",
] as const;

export interface Categorization {
  category: string;
  tags: string[];
}

/** An existing library tag and how many bookmarks use it. */
export interface TagCount {
  name: string;
  count: number;
}

export interface PageFacts {
  url: string;
  domain: string;
  title: string;
  description: string | null;
  og: OpenGraph;
}

/**
 * Categorize a page. Uses Gemini when a client is available; otherwise a
 * domain/keyword heuristic so the app is fully usable without an API key.
 */
export async function categorize(
  gemini: GeminiClient | null,
  page: PageFacts,
  existingTags: TagCount[] = [],
): Promise<Categorization> {
  let result: Categorization | null = null;
  if (gemini) {
    try {
      result = await aiCategorize(gemini, page, existingTags);
    } catch (err) {
      console.warn(`[categorize] Gemini failed, using heuristic: ${(err as Error).message}`);
    }
  }
  result ??= heuristicCategorize(page);
  // A tag that merely repeats the category is noise next to the badge.
  const category = result.category;
  result.tags = result.tags.filter((t) => t.toLowerCase() !== category.toLowerCase());
  return result;
}

async function aiCategorize(
  gemini: GeminiClient,
  page: PageFacts,
  existingTags: TagCount[],
): Promise<Categorization> {
  const prompt = [
    "Categorize this bookmarked web page.",
    `Pick exactly one category from: ${CATEGORIES.join(", ")}.`,
    "Also produce 4-8 short lowercase topic tags (single words or two-word phrases). Be comprehensive: cover the subject matter, the content type (e.g. article, video, tool, docs, course), and key technologies, products, or people when relevant.",
    "Reuse the existing library tags below whenever they fit; invent a new tag only when none covers the page. Never use the category itself as a tag.",
    existingTags.length
      ? `Existing library tags (tag:count): ${existingTags.map((t) => `${t.name}:${t.count}`).join(", ")}`
      : "",
    "",
    `URL: ${page.url}`,
    `Domain: ${page.domain}`,
    `Title: ${page.title}`,
    page.description ? `Description: ${page.description}` : "",
    page.og.siteName ? `Site: ${page.og.siteName}` : "",
    page.og.type ? `OG type: ${page.og.type}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await gemini.generateJson<{ category: string; tags: string[] }>(prompt, {
    type: "object",
    properties: {
      category: { type: "string", enum: [...CATEGORIES] },
      tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
    },
    required: ["category", "tags"],
  });

  const category = (CATEGORIES as readonly string[]).includes(result.category)
    ? result.category
    : "Other";
  const tags = (result.tags ?? [])
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 0 && t.length <= 32)
    .slice(0, 8);
  return { category, tags };
}

const DOMAIN_RULES: [RegExp, string][] = [
  [/github\.|gitlab\.|stackoverflow\.|npmjs\.|pypi\./, "Development"],
  [/figma\.|dribbble\.|behance\./, "Design"],
  [/huggingface\.|openai\.|anthropic\.|arxiv\./, "AI & ML"],
  [/youtube\.|vimeo\.|twitch\./, "Video"],
  [/spotify\.|soundcloud\.|music\.apple/, "Music"],
  [/twitter\.|x\.com|reddit\.|linkedin\.|instagram\.|facebook\.|bsky\./, "Social"],
  [/amazon\.|ebay\.|etsy\.|aliexpress\./, "Shopping"],
  [/nytimes\.|bbc\.|cnn\.|theguardian\.|reuters\.|news\./, "News"],
  [/wikipedia\.|docs\.|developer\.|devdocs\.|mdn\./, "Docs & Reference"],
  [/notion\.|linear\.|asana\.|trello\.|slack\./, "Productivity"],
  [/netflix\.|hulu\.|imdb\./, "Entertainment"],
];

const KEYWORD_RULES: [RegExp, string][] = [
  [/\b(api|sdk|programming|code|framework|library|typescript|python|rust)\b/i, "Development"],
  [/\b(design|ui|ux|typography|figma)\b/i, "Design"],
  [/\b(ai|llm|machine learning|neural|model|gpt|claude|gemini)\b/i, "AI & ML"],
  [/\b(recipe|cooking|restaurant)\b/i, "Food"],
  [/\b(travel|flight|hotel|itinerary)\b/i, "Travel"],
  [/\b(stock|invest|crypto|budget)\b/i, "Finance"],
  [/\b(workout|fitness|health|medical)\b/i, "Health"],
];

export function heuristicCategorize(page: PageFacts): Categorization {
  const haystack = `${page.title} ${page.description ?? ""}`;
  let category = "Other";

  for (const [re, cat] of DOMAIN_RULES) {
    if (re.test(page.domain)) {
      category = cat;
      break;
    }
  }
  if (category === "Other") {
    for (const [re, cat] of KEYWORD_RULES) {
      if (re.test(haystack)) {
        category = cat;
        break;
      }
    }
  }

  const tags = [...new Set([page.domain.split(".")[0], category.toLowerCase()])].filter(
    (t): t is string => !!t && t !== "other",
  );
  return { category, tags };
}
