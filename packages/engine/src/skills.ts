import { randomUUID } from "node:crypto";
import {
  deleteSkill as deleteSkillRow,
  getSkill,
  getSkillByName,
  insertSkill,
  listEnabledSkills,
  listSkills as listSkillRows,
  updateSkill as updateSkillRow,
  type Db,
  type SkillRow,
} from "@bookmark-ai/db";
import {
  createSkillSchema,
  parseSkillMarkdown,
  SKILLS_PROMPT_LIMIT,
  SKILL_MARKDOWN_MAX,
  SKILL_NAME_CONFLICT_MESSAGE,
  type CreateSkillInput,
  type Skill,
  type SkillIndex,
  type UpdateSkillInput,
} from "@bookmark-ai/types";
import { followRedirects, readCapped } from "./net-guard";

/**
 * Skills orchestration: the CRUD the `/api/skills` routes are a thin adapter
 * over, plus the two reads the chat agent needs — the capped prompt INDEX
 * (name + description of enabled skills) and the on-demand `useSkill` lookup
 * that returns a skill's instructions. Input shapes are validated by the Zod
 * schemas in `@bookmark-ai/types` before they get here; this module owns the
 * rule Zod can't express: name uniqueness, case-insensitive.
 */

/** A create/rename collides (case-insensitively) with another skill → 409. */
export class SkillNameConflictError extends Error {
  constructor() {
    super(SKILL_NAME_CONFLICT_MESSAGE);
    this.name = "SkillNameConflictError";
  }
}

/** The id is unknown → 404. */
export class SkillNotFoundError extends Error {
  constructor() {
    super("Skill not found");
    this.name = "SkillNotFoundError";
  }
}

/** Row → API shape (identical fields today; kept as the one mapping point). */
export function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every skill, newest updated first. */
export async function listSkills(db: Db): Promise<Skill[]> {
  return (await listSkillRows(db)).map(toSkill);
}

export async function getSkillRecord(db: Db, id: string): Promise<Skill | null> {
  const row = await getSkill(db, id);
  return row ? toSkill(row) : null;
}

/** Create a skill. Throws SkillNameConflictError on a (case-insensitive) duplicate name. */
export async function createSkill(db: Db, input: CreateSkillInput): Promise<Skill> {
  if (await getSkillByName(db, input.name)) throw new SkillNameConflictError();
  const now = new Date().toISOString();
  const row = await insertSkill(db, {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  });
  return toSkill(row);
}

/**
 * Partial update. A rename is checked against every OTHER skill (renaming to a
 * different casing of its own name is fine). Throws SkillNotFoundError /
 * SkillNameConflictError.
 */
export async function updateSkill(db: Db, id: string, patch: UpdateSkillInput): Promise<Skill> {
  const existing = await getSkill(db, id);
  if (!existing) throw new SkillNotFoundError();
  if (patch.name !== undefined) {
    const clash = await getSkillByName(db, patch.name);
    if (clash && clash.id !== id) throw new SkillNameConflictError();
  }
  const row = await updateSkillRow(db, id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  });
  if (!row) throw new SkillNotFoundError();
  return toSkill(row);
}

/** Delete by id. Returns whether it existed. */
export async function deleteSkill(db: Db, id: string): Promise<boolean> {
  return deleteSkillRow(db, id);
}

/**
 * The prompt index: ENABLED skills, newest updated first, capped at
 * SKILLS_PROMPT_LIMIT, plus the uncapped total. Never throws — a skills read
 * failing must not take the whole chat turn down, so it degrades to an empty
 * index (and the agent simply has no skills that turn).
 */
export async function resolveSkillIndex(db: Db, limit = SKILLS_PROMPT_LIMIT): Promise<SkillIndex> {
  try {
    const { skills, total } = await listEnabledSkills(db, limit);
    return {
      skills: skills.map((s) => ({ name: s.name, description: s.description })),
      total,
    };
  } catch (err) {
    console.warn("[skills] index read failed, continuing without skills:", (err as Error).message);
    return { skills: [], total: 0 };
  }
}

// ── Programmatic creation (SKILL.md import, chat tools) ───────────────────────

/** Read budget for a fetched SKILL.md — the same cap the import route enforces. */
export const SKILL_FETCH_MAX_BYTES = SKILL_MARKDOWN_MAX;

/**
 * Fetch a SKILL.md from a URL THROUGH THE SSRF GUARD (`followRedirects`:
 * scheme/port checks, DNS resolution rejecting loopback/private/link-local/
 * metadata hosts, bounded redirects and timeout), text responses only, read
 * capped at 64 KB. Throws a readable error on block / non-OK / non-text.
 */
export async function fetchSkillMarkdown(url: string): Promise<string> {
  const res = await followRedirects(url, {
    accept: "text/markdown,text/plain;q=0.9,*/*;q=0.5",
  });
  // null = the redirect budget was exceeded (every hop is re-validated).
  if (res === null) throw new Error("too many redirects");
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`the URL answered HTTP ${res.status}`);
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html")) {
    await res.body?.cancel().catch(() => {});
    throw new Error("the URL returned a web page, not a raw SKILL.md — use the file's Raw URL");
  }
  if (contentType && !/^text\/|markdown|json|octet-stream/.test(contentType)) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`the URL returned "${contentType}", not a text file`);
  }
  return readCapped(res, SKILL_FETCH_MAX_BYTES);
}

/** What the chat tools return: the created skill's identity (plus any parse
 * warnings, e.g. a shortened description), or a readable error. */
export type AgentSkillResult =
  | { skill: Pick<Skill, "id" | "name" | "description">; warnings?: string[] }
  | { error: string };

/**
 * The `createSkill` tool body: validate like POST /api/skills, create, and turn
 * a name conflict into `{ error }` that names the clash and suggests picking a
 * different name — so the model can self-correct instead of the stream dying.
 */
export async function createSkillForAgent(db: Db, input: unknown): Promise<AgentSkillResult> {
  const parsed = createSkillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid skill" };
  try {
    const skill = await createSkill(db, parsed.data);
    return { skill: { id: skill.id, name: skill.name, description: skill.description } };
  } catch (err) {
    if (err instanceof SkillNameConflictError) {
      return {
        error: `A skill named "${parsed.data.name}" already exists — choose a different name, or ask the user whether to update the existing one instead.`,
      };
    }
    return { error: (err as Error).message };
  }
}

export interface InstallSkillOptions {
  enabled?: boolean;
  /** Test seam: replaces the net-guarded fetch. */
  fetchMarkdown?: (url: string) => Promise<string>;
}

/**
 * The `installSkill` tool body: fetch a SKILL.md from a URL the USER typed
 * (the prompt forbids URLs found in fetched content), parse it, create the
 * skill. Every failure is `{ error }` with the reason, never a throw.
 */
export async function installSkillForAgent(
  db: Db,
  url: string,
  opts: InstallSkillOptions = {},
): Promise<AgentSkillResult> {
  const target = typeof url === "string" ? url.trim() : "";
  if (!/^https?:\/\//i.test(target)) return { error: "Only http(s) URLs can be installed" };
  let markdown: string;
  try {
    markdown = await (opts.fetchMarkdown ?? fetchSkillMarkdown)(target);
  } catch (err) {
    return { error: `Couldn't fetch ${target}: ${(err as Error).message}` };
  }
  const parsed = parseSkillMarkdown(markdown);
  if ("error" in parsed) return { error: `${target} isn't a valid SKILL.md: ${parsed.error}` };
  const { warnings, ...fields } = parsed;
  const created = await createSkillForAgent(db, { ...fields, enabled: opts.enabled ?? true });
  return "skill" in created && warnings?.length ? { ...created, warnings } : created;
}

/**
 * The `useSkill` tool body. Case-insensitive lookup; a disabled skill is
 * reported as such rather than applied; an unknown name lists what IS
 * available so the model can self-correct. Returns `{ error }` instead of
 * throwing so a failure can't break the stream.
 */
export async function useSkillByName(
  db: Db,
  name: string,
): Promise<{ name: string; instructions: string } | { error: string }> {
  try {
    const wanted = name.trim();
    if (!wanted) return { error: "Skill name is required" };
    const row = await getSkillByName(db, wanted);
    if (!row) {
      const available = (await listEnabledSkills(db, SKILLS_PROMPT_LIMIT)).skills.map((s) => s.name);
      return {
        error: available.length
          ? `No skill named "${wanted}". Available skills: ${available.join(", ")}`
          : `No skill named "${wanted}". The user has no enabled skills.`,
      };
    }
    if (!row.enabled) return { error: `Skill "${row.name}" is disabled` };
    return { name: row.name, instructions: row.instructions };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
