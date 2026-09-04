import {
  SKILL_MARKDOWN_MAX,
  parseSkillMarkdown,
  type ParseSkillMarkdownResult,
  type ParsedSkillMarkdown,
} from "@bookmark-ai/types";
import type { SkillDraft } from "./skills";

/**
 * SKILL.md (agentskills.io) import for the Skills manager (CONTRACT §3b.1).
 *
 * The parser is the shared one — `parseSkillMarkdown` in
 * `packages/types/src/skills.ts`, the same rules `POST /api/skills/import` and
 * the chat's `createSkill`/`installSkill` tools apply — so what the editor
 * shows prefilled is exactly what the server would accept. This module adds
 * the browser-side gates (file type/size) and the draft shape. Pure and
 * unit-tested (skill-markdown.test.ts).
 */

export { parseSkillMarkdown, SKILL_MARKDOWN_MAX };
export type { ParseSkillMarkdownResult, ParsedSkillMarkdown };

/** Files the importer accepts (matched by extension — OS MIME for .md is unreliable). */
export const SKILL_FILE_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
export const SKILL_FILE_ACCEPT = ".md,.markdown,.txt,text/markdown,text/plain";

export const SKILL_IMPORT_COPY = {
  wrongType: "Only .md or .txt files can be imported.",
  tooLarge: `That file is too large to be a skill (max ${SKILL_MARKDOWN_MAX / 1024} KB).`,
  unreadable: "That file couldn't be read.",
} as const;

/** Parse → an editor draft (enabled, ready for review) plus any non-fatal
 * parser adjustments to show the user (e.g. a description shortened to fit),
 * or the parse error. */
export function draftFromMarkdown(
  text: string,
): { draft: SkillDraft; warnings?: string[] } | { error: string } {
  const parsed = parseSkillMarkdown(text);
  if ("error" in parsed) return parsed;
  const { name, description, instructions, warnings } = parsed;
  return {
    draft: { name, description, instructions, enabled: true },
    ...(warnings?.length ? { warnings } : {}),
  };
}

/** Extension gate for the file picker / drop target. */
export function isSkillFileName(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SKILL_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** The pre-read gate: wrong type / too large → the copy to show, else null. */
export function skillFileError(file: { name: string; size: number }): string | null {
  if (!isSkillFileName(file.name)) return SKILL_IMPORT_COPY.wrongType;
  if (file.size > SKILL_MARKDOWN_MAX) return SKILL_IMPORT_COPY.tooLarge;
  return null;
}
