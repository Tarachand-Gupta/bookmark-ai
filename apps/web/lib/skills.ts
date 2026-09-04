import {
  SKILL_DESCRIPTION_MAX,
  SKILL_INSTRUCTIONS_MAX,
  SKILL_NAME_MAX,
  type CreateSkillInput,
  type Skill,
  type UpdateSkillInput,
} from "@bookmark-ai/types";

/**
 * Skills — the user's reusable instruction bundles Ask AI follows when they fit
 * a request (CONTRACT §3, agentskills.io shape, v1).
 *
 * The record + input types and the field limits come from `@bookmark-ai/types`
 * (packages/types/src/skills.ts — the same schemas the API validates with), so
 * the editor's inline validation matches exactly what the server would reject.
 * Everything here is framework-free and unit-tested (skills.test.ts).
 */

export type { CreateSkillInput, Skill, UpdateSkillInput };

export const SKILL_LIMITS = {
  name: { min: 1, max: SKILL_NAME_MAX },
  description: { min: 1, max: SKILL_DESCRIPTION_MAX },
  instructions: { min: 1, max: SKILL_INSTRUCTIONS_MAX },
} as const;

/** Letters, digits, spaces, hyphens, underscores — Unicode letters allowed so a
 * non-English name isn't rejected for being non-ASCII. */
export const SKILL_NAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export type SkillDraftErrors = Partial<Record<"name" | "description" | "instructions", string>>;

/** Client-side validation for the editor. Mirrors the server's rules so the
 * user sees the problem inline instead of as a 400 after clicking Save. */
export function validateSkillDraft(draft: SkillDraft): SkillDraftErrors {
  const errors: SkillDraftErrors = {};
  const name = draft.name.trim();
  if (name.length < SKILL_LIMITS.name.min) {
    errors.name = "Give the skill a name.";
  } else if (name.length > SKILL_LIMITS.name.max) {
    errors.name = `Keep the name under ${SKILL_LIMITS.name.max} characters.`;
  } else if (!SKILL_NAME_PATTERN.test(name)) {
    errors.name = "Use letters, numbers, spaces, hyphens or underscores.";
  }

  const description = draft.description.trim();
  if (description.length < SKILL_LIMITS.description.min) {
    errors.description = "Add a one-line description — it's how Ask AI decides when to use this.";
  } else if (description.length > SKILL_LIMITS.description.max) {
    errors.description = `Keep the description under ${SKILL_LIMITS.description.max} characters.`;
  }

  const instructions = draft.instructions;
  if (instructions.trim().length < SKILL_LIMITS.instructions.min) {
    errors.instructions = "Write the instructions Ask AI should follow.";
  } else if (instructions.length > SKILL_LIMITS.instructions.max) {
    errors.instructions = `Instructions are capped at ${SKILL_LIMITS.instructions.max.toLocaleString("en-US")} characters.`;
  }
  return errors;
}

/** The wire payload for a draft: trimmed name/description, instructions as
 * typed (leading whitespace can be meaningful in markdown). Typed as the
 * schema's INPUT shape (`enabled` optional on the wire) — we always send it. */
export function toSkillInput(draft: SkillDraft): UpdateSkillInput & CreateSkillInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    instructions: draft.instructions,
    enabled: draft.enabled,
  };
}

export const EMPTY_SKILL_DRAFT: SkillDraft = {
  name: "",
  description: "",
  instructions: "",
  enabled: true,
};

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

/**
 * Starter templates (client-side only, never DB rows). Each is a complete,
 * editable skill written in the user's voice — the user reviews and saves it.
 * They lean on the tools Ask AI actually has (searchBookmarks, queryDatabase,
 * listSessions, fetchUrl) so a saved template works on day one.
 */
export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: "weekly-digest",
    name: "Weekly reading digest",
    description:
      "Turn everything I saved this week into a short digest: the themes, the best links, what to read first.",
    instructions: [
      "When I ask for my weekly digest (or what I saved this week):",
      "",
      "1. Use queryDatabase to pull every bookmark from the last 7 days (saved_day, title, url, domain, category, tags_json).",
      "2. Group them into 3–5 themes by category and tags — name each theme in plain words, not category labels.",
      "3. For each theme, list the 2–3 most worthwhile links as [title](url) with a one-line reason to open it.",
      "4. Finish with \"Read first\": the single link I should not skip, and why.",
      "",
      "Keep it under 250 words. If nothing was saved this week, say so and offer to widen to 14 days.",
    ].join("\n"),
  },
  {
    id: "research-brief",
    name: "Research brief",
    description:
      "Build a structured brief on a topic from my bookmarks and sessions, with every claim linked to a source.",
    instructions: [
      "When I ask for a brief, summary or overview of a topic:",
      "",
      "1. Run searchBookmarks in hybrid mode for the topic (and one or two obvious synonyms).",
      "2. Check listSessions for saved sessions whose tabs relate to it.",
      "3. If fewer than three sources turn up, say so before writing — don't pad with web results unless I ask.",
      "4. Read up to three of the strongest sources with fetchUrl when the saved title alone isn't enough.",
      "",
      "Write the brief with these headings: Summary (3 sentences), Key findings (bullets, each ending in a [title](url) citation), Sources (every link used), Open questions.",
      "",
      "Never state a fact that isn't backed by one of the linked sources.",
    ].join("\n"),
  },
  {
    id: "link-triage",
    name: "Link triage",
    description:
      "Sort my recent saves into keep / read later / drop, one line each, so I can clean up fast.",
    instructions: [
      "When I ask to triage, clean up or sort my recent links:",
      "",
      "1. Use queryDatabase to fetch the last 20 bookmarks (or the range I name) with title, url, domain, category, saved_day.",
      "2. Put each one in exactly one bucket: Keep (reference I'll return to), Read later (worth a sitting), Drop (news that has aged out, duplicates, pages I clearly saved by accident).",
      "3. Present a markdown table: Bucket · [Title](url) · one-line reason.",
      "4. Point out duplicates and near-duplicates explicitly.",
      "",
      "Be decisive — a link goes in one bucket. Don't delete anything; I'll do that myself.",
    ].join("\n"),
  },
];

/** A draft pre-filled from a template (enabled, ready to edit or save). */
export function draftFromTemplate(template: SkillTemplate): SkillDraft {
  return {
    name: template.name,
    description: template.description,
    instructions: template.instructions,
    enabled: true,
  };
}

/** Draft ↔ record for the edit flow. */
export function draftFromSkill(skill: Skill): SkillDraft {
  return {
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    enabled: skill.enabled,
  };
}

/**
 * Cross-surface "the skills changed" signal: the chat's `createSkill` /
 * `installSkill` tools add rows the Skills manager (if open) must show without
 * a reload. A window event keeps the two components decoupled.
 */
export const SKILLS_CHANGED_EVENT = "bookmark-ai:skills-changed";

export function notifySkillsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
}

/** Newest-updated first — the order the list API promises; applied locally
 * after an optimistic edit so the row the user just touched rises to the top. */
export function sortSkills(skills: readonly Skill[]): Skill[] {
  return [...skills].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}
