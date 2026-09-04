import { z } from "zod";

/**
 * Skills — the user's reusable instruction bundles (agentskills.io shape, v1):
 * a name, a one-line description that tells Ask AI WHEN the skill applies, and
 * the instructions it follows once it does. Stored per tenant (`skills` table,
 * tenant migration v14), exported with the user's data (export bundle v5), and
 * surfaced to the chat agent two ways: an index of enabled skills in the system
 * prompt (name + description only) and a `useSkill({ name })` tool that returns
 * the instructions on demand. Skills are the user's OWN instructions and are
 * trusted; content fetched from the web is not.
 */

export const SKILL_NAME_MAX = 60;
export const SKILL_DESCRIPTION_MAX = 200;
export const SKILL_INSTRUCTIONS_MAX = 32_000;

/** How many enabled skills the chat system prompt lists (newest updated first). */
export const SKILLS_PROMPT_LIMIT = 40;

/** Letters (any script), digits, spaces, hyphens and underscores. */
const SKILL_NAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Skill = z.infer<typeof skillSchema>;

/** POST /api/skills body. Name uniqueness (case-insensitive) is enforced by the
 * server with a 409, not here. */
export const createSkillSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(SKILL_NAME_MAX, `Name must be ${SKILL_NAME_MAX} characters or fewer`)
    .regex(SKILL_NAME_PATTERN, "Name may only use letters, digits, spaces, hyphens and underscores"),
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(SKILL_DESCRIPTION_MAX, `Description must be ${SKILL_DESCRIPTION_MAX} characters or fewer`),
  instructions: z
    .string()
    .min(1, "Instructions are required")
    .max(SKILL_INSTRUCTIONS_MAX, `Instructions must be ${SKILL_INSTRUCTIONS_MAX} characters or fewer`),
  enabled: z.boolean().default(true),
});
export type CreateSkillInput = z.infer<typeof createSkillSchema>;

/** PUT /api/skills/:id body — any subset of the create fields. */
export const updateSkillSchema = createSkillSchema.partial();
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;

/** GET /api/skills → every skill (enabled or not), newest updated first. */
export const listSkillsResponseSchema = z.object({ skills: z.array(skillSchema) });
export type ListSkillsResponse = z.infer<typeof listSkillsResponseSchema>;

/** POST /api/skills (201) · GET/PUT /api/skills/:id. */
export const skillResponseSchema = z.object({ skill: skillSchema });
export type SkillResponse = z.infer<typeof skillResponseSchema>;

/** 409 body when a create/rename collides (case-insensitively) with another skill. */
export const SKILL_NAME_CONFLICT_MESSAGE = "A skill with this name already exists";

/** What the chat prompt gets: enabled skills, capped, plus the true total so the
 * prompt can say "showing 40 of N". */
export interface SkillIndex {
  skills: Pick<Skill, "name" | "description">[];
  /** Total ENABLED skills (may exceed `skills.length` when capped). */
  total: number;
}

// ── SKILL.md (agentskills.io) ─────────────────────────────────────────────────

/** Upper bound on a SKILL.md document (frontmatter + body) accepted for import. */
export const SKILL_MARKDOWN_MAX = 64 * 1024;

/** POST /api/skills/import body. */
export const importSkillSchema = z.object({
  markdown: z
    .string()
    .min(1, "Markdown is required")
    .max(SKILL_MARKDOWN_MAX, `SKILL.md must be ${SKILL_MARKDOWN_MAX / 1024} KB or smaller`),
  enabled: z.boolean().optional(),
});
export type ImportSkillInput = z.infer<typeof importSkillSchema>;

export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  instructions: string;
  /** Non-fatal adjustments made while parsing (e.g. an over-long description
   * shortened to fit). Absent when nothing was changed. */
  warnings?: string[];
}
export type ParseSkillMarkdownResult = ParsedSkillMarkdown | { error: string };

/** Shorten a description to SKILL_DESCRIPTION_MAX at a word boundary with an ellipsis. */
function shortenDescription(description: string): string {
  const max = SKILL_DESCRIPTION_MAX;
  if (description.length <= max) return description;
  const cut = description.slice(0, max - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/** A starter SKILL.md, shown by the import UIs and used by the docs. */
export const SKILL_MARKDOWN_TEMPLATE = `---
name: Weekly reading digest
description: Summarise what I saved this week, grouped by theme, with the 3 most worth finishing
---

1. List the bookmarks saved in the last 7 days (title, URL, category, tags).
2. Group them into 3-6 themes.
3. One line per bookmark, as a markdown link.
4. Close with the 3 items most worth finishing and why. Be brief.
`;

/**
 * A plain scalar value: quoted (`"…"` with `\"`/`\\` escapes, `'…'` with `''`)
 * — the closing quote ends the value and anything after it (a `# comment`) is
 * dropped — or bare, where a ` # comment` suffix is stripped.
 */
function scalarValue(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    let out = "";
    for (let k = 1; k < v.length; k++) {
      const ch = v[k] ?? "";
      if (ch === "\\" && k + 1 < v.length) {
        out += v[k + 1] ?? "";
        k++;
      } else if (ch === '"') {
        return out;
      } else {
        out += ch;
      }
    }
    return out; // unterminated: take what we have
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    const inner = end < 0 ? v.slice(1) : v.slice(1, end);
    return inner.replace(/''/g, "'");
  }
  return v.replace(/[ \t]+#.*$/, "").trim();
}

/**
 * The YAML subset a SKILL.md frontmatter uses: `key: value` at column 0, values
 * optionally quoted, block scalars (`>` / `>-` folded, `|` / `|-` literal) with
 * indented continuation lines, and nested/unknown keys (`metadata:`,
 * `allowed-tools:`, `license:`) skipped along with their indented children.
 * Returns only the scalar keys we care about; never throws.
 */
function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i] ?? "");
    if (!m) {
      i++;
      continue;
    }
    const key = (m[1] ?? "").toLowerCase();
    const rest = (m[2] ?? "").trim();
    // Gather indented continuation lines (block scalars, nested maps).
    const cont: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j] ?? "";
      if (!/^[ \t]/.test(line) && line.trim() !== "") break;
      cont.push(line);
      j++;
    }
    // Trailing blank lines belong to nothing.
    while (cont.length && (cont[cont.length - 1] ?? "").trim() === "") cont.pop();
    if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
      const body = cont.map((l) => l.replace(/^[ \t]+/, ""));
      out[key] = rest.startsWith(">")
        ? body.join(" ").replace(/\s+/g, " ").trim()
        : body.join("\n").trim();
    } else if (rest !== "") {
      out[key] = scalarValue(rest);
    }
    // (rest === "" with children → a nested map we ignore.)
    i = j;
  }
  return out;
}

/**
 * Parse a SKILL.md (agentskills.io shape): YAML frontmatter with `name:` and
 * `description:`, markdown body = instructions. Without frontmatter the first
 * `# Heading` is the name, the first paragraph under it the description and
 * the rest the instructions. Applies the same limits as `createSkillSchema`
 * and returns `{ error }` with a readable message instead of throwing — except
 * the description, which is a ONE-LINE trigger: it is flattened to a single
 * line and, if longer than SKILL_DESCRIPTION_MAX (agentskills.io allows 1,024),
 * shortened at a word boundary with a `warnings` entry rather than refused,
 * because every canonical public SKILL.md would otherwise fail to import. CRLF
 * and a BOM are tolerated. Extra frontmatter keys are ignored.
 */
export function parseSkillMarkdown(raw: string): ParseSkillMarkdownResult {
  if (typeof raw !== "string") return { error: "Skill markdown must be text" };
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") return { error: "The skill file is empty" };

  let name: string;
  let description: string;
  let body: string;

  const fm = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (fm) {
    const fields = parseFrontmatter(fm[1] ?? "");
    name = fields.name ?? "";
    description = fields.description ?? "";
    if (!name.trim()) return { error: "The frontmatter needs a `name:` line" };
    if (!description.trim()) {
      return { error: "The frontmatter needs a `description:` line — one line on when Ask AI should use this skill" };
    }
    body = text.slice(fm[0].length);
  } else {
    const lines = text.split("\n");
    const h = lines.findIndex((l) => /^#[ \t]+\S/.test(l));
    if (h < 0) {
      return {
        error:
          "Couldn't find a skill in this file: add YAML frontmatter with `name:` and `description:`, or start with a `# Heading` for the name",
      };
    }
    name = (lines[h] ?? "").replace(/^#[ \t]+/, "").trim();
    const rest = lines.slice(h + 1);
    let i = 0;
    while (i < rest.length && (rest[i] ?? "").trim() === "") i++;
    const para: string[] = [];
    while (i < rest.length && (rest[i] ?? "").trim() !== "") para.push(rest[i++] ?? "");
    description = para.join(" ").replace(/\s+/g, " ").trim();
    if (!description) {
      return { error: "Add a one-line description under the heading — this is how Ask AI decides when to use the skill" };
    }
    body = rest.slice(i).join("\n");
  }

  const instructions = body.trim();
  if (!instructions) {
    return { error: "The skill has no instructions — add what Ask AI should do below the description" };
  }
  // agentskills.io allows descriptions up to 1,024 chars; ours is a one-line
  // trigger capped at 200. Shorten rather than refuse — the stored value stays
  // within the limit and the user can tighten it in the editor — and say so.
  const warnings: string[] = [];
  const flatDescription = description.replace(/\s+/g, " ").trim();
  const fitDescription = shortenDescription(flatDescription);
  if (fitDescription !== flatDescription) {
    warnings.push(
      `Description shortened from ${flatDescription.length} to ${SKILL_DESCRIPTION_MAX} characters (the one-line trigger limit) — edit it in Settings → Skills if needed`,
    );
  }
  const checked = createSkillSchema.safeParse({ name, description: fitDescription, instructions });
  if (!checked.success) return { error: checked.error.issues[0]?.message ?? "Invalid skill" };
  return {
    name: checked.data.name,
    description: checked.data.description,
    instructions: checked.data.instructions,
    ...(warnings.length ? { warnings } : {}),
  };
}

/** A SKILL.md for a skill: frontmatter (values double-quoted/escaped so any
 * text round-trips through `parseSkillMarkdown`) + the instructions as body. */
export function serializeSkillMarkdown(skill: Pick<Skill, "name" | "description" | "instructions">): string {
  const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
  return `---\nname: ${quote(skill.name)}\ndescription: ${quote(skill.description)}\n---\n\n${skill.instructions.replace(/\r\n?/g, "\n").trim()}\n`;
}
