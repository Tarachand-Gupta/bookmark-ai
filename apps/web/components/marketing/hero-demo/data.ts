/**
 * The demo's script and its stage geometry.
 *
 * Everything the five beats need to know about *content* lives here so the
 * timeline can stay a pure storyboard and the mocks can stay pure markup.
 */

/**
 * The page the demo saves. This is deliberately the same paper that beat 5's
 * search finds — the whole point of the film is that you watch one page go in
 * and then watch it come back out by meaning.
 */
export const SAVED_PAGE = {
  mark: "A",
  title: "Attention Is All You Need",
  url: "arxiv.org/abs/1706.03762",
  category: "Research",
} as const;

/**
 * The query typed in beat 5.
 *
 * Load-bearing: not one of these words ("that", "paper", "everyone", "cites",
 * "about", "transformers") appears in either matching title. A keyword search
 * returns nothing here — only embeddings connect the query to the results. If
 * you ever edit this string or the two matches, keep that property true, or the
 * demo starts quietly lying about what the product does.
 */
export const QUERY = "that paper everyone cites about transformers";

export type DemoCard = {
  /** `saved` is the page we just bookmarked; `saved` + `match` survive the search. */
  role: "saved" | "match" | "other";
  mark: string;
  domain: string;
  title: string;
  cat: string;
  when: string;
};

/** Illustrative library — not real data, but shaped like it. */
export const LIBRARY: DemoCard[] = [
  {
    role: "saved",
    mark: SAVED_PAGE.mark,
    domain: "arxiv.org",
    title: SAVED_PAGE.title,
    cat: SAVED_PAGE.category,
    when: "now",
  },
  {
    role: "match",
    mark: "A",
    domain: "arxiv.org",
    title: "Neural Machine Translation by Jointly Learning to Align and Translate",
    cat: "Research",
    when: "3d",
  },
  {
    role: "other",
    mark: "R",
    domain: "react.dev",
    title: "React — the library for web and native UIs",
    cat: "Development",
    when: "2d",
  },
  {
    role: "other",
    mark: "F",
    domain: "figma.com",
    title: "The collaborative interface design tool",
    cat: "Design",
    when: "5d",
  },
  {
    role: "other",
    mark: "T",
    domain: "tailwindcss.com",
    title: "Build modern sites without leaving your HTML",
    cat: "Design",
    when: "1w",
  },
  {
    role: "other",
    mark: "S",
    domain: "supabase.com",
    title: "The open source Firebase alternative",
    cat: "Development",
    when: "4d",
  },
  {
    role: "other",
    mark: "G",
    domain: "ai.google.dev",
    title: "Gemini API — text embeddings",
    cat: "AI",
    when: "6d",
  },
  {
    role: "other",
    mark: "R",
    domain: "doc.rust-lang.org",
    title: "The Rust Programming Language",
    cat: "Development",
    when: "1w",
  },
];

/** Sidebar facets — counts add up to LIBRARY, because someone will check. */
export const CATEGORY_FACETS = [
  { name: "Research", count: 2 },
  { name: "Development", count: 3 },
  { name: "Design", count: 2 },
  { name: "AI", count: 1 },
];

export const BROWSER_FACETS = [
  { name: "Chrome", count: 6 },
  { name: "Safari", count: 2 },
];

export const TOTAL = LIBRARY.length;

export const SESSION_TABS = 7;

/**
 * Stage geometry, in percent of the stage box.
 *
 * `browser` is where the floating browser window sits over the dashboard.
 * `closeup` is the invisible box beat 1 frames — the camera measures it at
 * runtime and solves its own scale/offset, so retuning the opening shot means
 * nudging these four numbers and nothing else. Their ratio *is* the zoom: a
 * 40%-wide closeup means the camera pushes in ~2.35x, which is also how far it
 * pulls back in beat 4.
 */
export const GEO = {
  browser: { left: 32, top: 14, width: 36, height: 34 },
  closeup: { left: 30, top: 11.5, width: 40, height: 38.5 },
} as const;

/** Element handles shared by the mocks (which set them) and the timeline (which drives them). */
export const sel = {
  stage: "[data-demo='stage']",
  camera: "[data-demo='camera']",
  closeup: "[data-demo='closeup']",

  browser: "[data-demo='browser']",
  extIcon: "[data-demo='ext-icon']",
  extIconGlow: "[data-demo='ext-glow']",
  ripple: "[data-demo='ripple']",

  popup: "[data-demo='popup']",
  saveBtn: "[data-demo='save-btn']",
  saveIdle: "[data-demo='save-idle']",
  saveBusy: "[data-demo='save-busy']",
  saveDone: "[data-demo='save-done']",
  spinner: "[data-demo='spinner']",
  popupUrl: "[data-demo='popup-url']",
  popupChip: "[data-demo='popup-chip']",

  dashboard: "[data-demo='dashboard']",
  card: "[data-demo='card']",
  cardOther: "[data-demo='card'][data-role='other']",
  cardKeep: "[data-demo='card'][data-role='saved'],[data-demo='card'][data-role='match']",
  cardSaved: "[data-demo='card'][data-role='saved']",
  ring: "[data-demo='ring']",
  savedFlash: "[data-demo='saved-flash']",

  searchField: "[data-demo='search-field']",
  searchRing: "[data-demo='search-ring']",
  searchText: "[data-demo='search-text']",
  searchPlaceholder: "[data-demo='search-ph']",
  caret: "[data-demo='caret']",
  metaAll: "[data-demo='meta-all']",
  metaResults: "[data-demo='meta-results']",

  cursorRig: "[data-demo='cursor-rig']",
  cursorGlyph: "[data-demo='cursor-glyph']",
} as const;
