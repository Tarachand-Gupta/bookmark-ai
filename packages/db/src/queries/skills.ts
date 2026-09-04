import type { Db } from "../client";

/**
 * Skills persistence (tenant DB, migration v14). A skill is the user's reusable
 * instruction bundle for Ask AI: `name` (unique, matched case-insensitively by
 * the engine), a one-line `description` the agent uses to decide WHEN it fits,
 * the `instructions` it follows, and an `enabled` flag (stored INTEGER 0/1).
 * Rows come back newest-updated first, which is also the order the chat prompt's
 * index is capped in.
 */

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InsertSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields `updateSkill` may write; an absent key is left untouched. */
export interface SkillPatch {
  name?: string;
  description?: string;
  instructions?: string;
  enabled?: boolean;
}

const PATCH_COLUMNS: [keyof SkillPatch, string][] = [
  ["name", "name"],
  ["description", "description"],
  ["instructions", "instructions"],
  ["enabled", "enabled"],
];

function rowToSkill(row: Record<string, unknown>): SkillRow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    instructions: String(row.instructions ?? ""),
    enabled: Boolean(Number(row.enabled ?? 1)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function insertSkill(db: Db, s: InsertSkill): Promise<SkillRow> {
  await db.execute({
    sql: `INSERT INTO skills (id, name, description, instructions, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [s.id, s.name, s.description, s.instructions, s.enabled ? 1 : 0, s.createdAt, s.updatedAt],
  });
  const saved = await getSkill(db, s.id);
  if (!saved) throw new Error("insertSkill: row not found after insert");
  return saved;
}

export async function getSkill(db: Db, id: string): Promise<SkillRow | null> {
  const rs = await db.execute({ sql: "SELECT * FROM skills WHERE id = ?", args: [id] });
  const row = rs.rows[0];
  return row ? rowToSkill(row as unknown as Record<string, unknown>) : null;
}

/** Case-insensitive name lookup (the uniqueness rule the API enforces). */
export async function getSkillByName(db: Db, name: string): Promise<SkillRow | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM skills WHERE name = ? COLLATE NOCASE LIMIT 1",
    args: [name],
  });
  const row = rs.rows[0];
  return row ? rowToSkill(row as unknown as Record<string, unknown>) : null;
}

/** Every skill (enabled or not), newest updated first. */
export async function listSkills(db: Db): Promise<SkillRow[]> {
  const rs = await db.execute("SELECT * FROM skills ORDER BY updated_at DESC, name ASC");
  return rs.rows.map((r) => rowToSkill(r as unknown as Record<string, unknown>));
}

/** ENABLED skills, newest updated first, capped — plus the uncapped total so the
 * caller can say "showing N of M". */
export async function listEnabledSkills(
  db: Db,
  limit: number,
): Promise<{ skills: SkillRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    db.execute({
      sql: "SELECT * FROM skills WHERE enabled = 1 ORDER BY updated_at DESC, name ASC LIMIT ?",
      args: [Math.max(0, Math.floor(limit))],
    }),
    db.execute("SELECT COUNT(*) AS n FROM skills WHERE enabled = 1"),
  ]);
  return {
    skills: rows.rows.map((r) => rowToSkill(r as unknown as Record<string, unknown>)),
    total: Number(count.rows[0]?.n ?? 0),
  };
}

/**
 * Partial update; `updated_at` is always refreshed (bumping the skill to the
 * top of the list and of the prompt index). Returns the saved row, or null when
 * the id is unknown.
 */
export async function updateSkill(
  db: Db,
  id: string,
  patch: SkillPatch,
  updatedAt: string = new Date().toISOString(),
): Promise<SkillRow | null> {
  const sets: string[] = ["updated_at = ?"];
  const args: (string | number)[] = [updatedAt];
  for (const [key, col] of PATCH_COLUMNS) {
    if (key in patch && patch[key] !== undefined) {
      const v = patch[key] as string | boolean;
      sets.push(`${col} = ?`);
      args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
  }
  args.push(id);
  const rs = await db.execute({ sql: `UPDATE skills SET ${sets.join(", ")} WHERE id = ?`, args });
  if (rs.rowsAffected === 0) return null;
  return getSkill(db, id);
}

/** Delete by id. Returns whether a row was removed. */
export async function deleteSkill(db: Db, id: string): Promise<boolean> {
  const rs = await db.execute({ sql: "DELETE FROM skills WHERE id = ?", args: [id] });
  return rs.rowsAffected > 0;
}
