import type { NewTabSettings, NewTabTemplate, NewTabTemplateConfig } from "@bookmark-ai/types";
import type { Db } from "../client";

/**
 * New Tab Canvas storage (tenant DB; see docs/features/newtab-canvas.md §4.2).
 * Templates are user data (they export); settings are UI state (they don't).
 * The `is_active` invariant — at most one active template — is enforced HERE
 * in app code (§4.2.1), not in SQL: a CHECK/trigger can't express "at most one
 * across the table". Every mutation that flips it runs as a batch() (libSQL
 * batches default to a transaction), so the deactivate-all + activate-one pair
 * can't observe a half-state.
 */

export interface InsertNewTabTemplate {
  id: string;
  name: string;
  html: string;
  config: NewTabTemplateConfig;
  isPreset: boolean;
}

/** Plain insert. ACTIVATION is the engine's job (saveNewTabTemplate), which
 *  owns the settings-key context — a plain insert can't know whether to mirror
 *  into newtab_settings or which key. */
export async function insertNewTabTemplate(
  db: Db,
  t: InsertNewTabTemplate,
): Promise<NewTabTemplate> {
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO newtab_templates (id, name, html, config_json, is_preset, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    // INSERT (not OR REPLACE) for CREATES: a colliding custom id is a bug the
    // caller should hear about. Presets seed with OR IGNORE separately instead.
    args: [t.id, t.name, t.html, JSON.stringify(t.config), t.isPreset ? 1 : 0, now, now],
  });
  const row = await getNewTabTemplate(db, t.id);
  if (!row) throw new Error("insertNewTabTemplate: row not found after insert");
  return row;
}

/** Seed the six presets keyed on their stable ids: INSERT OR IGNORE creates
 *  them on first use; the ON CONFLICT clause refreshes OUR preset bodies
 *  (name/html/config — the source of truth is the shipped code, and presets
 *  are read-only, so overwriting is safe) while leaving is_active alone. */
export async function seedNewTabPresets(
  db: Db,
  presets: { id: string; name: string; html: string; config: NewTabTemplateConfig }[],
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch(
    presets.map((p) => ({
      sql: `INSERT INTO newtab_templates
            (id, name, html, config_json, is_preset, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              html = excluded.html,
              config_json = excluded.config_json
            WHERE newtab_templates.html != excluded.html
               OR newtab_templates.name != excluded.name
               OR newtab_templates.config_json != excluded.config_json`,
      args: [p.id, p.name, p.html, JSON.stringify(p.config), now, now],
    })),
    "write",
  );
}

/** Newest updated first; presets and customs share the same list (§4.7 — the
 *  UI groups them, not the query). */
export async function listNewTabTemplates(db: Db): Promise<NewTabTemplate[]> {
  const rs = await db.execute(
    "SELECT * FROM newtab_templates ORDER BY updated_at DESC LIMIT 200",
  );
  return rs.rows.map((r) => rowToTemplate(r as unknown as Record<string, unknown>));
}

export async function getNewTabTemplate(db: Db, id: string): Promise<NewTabTemplate | null> {
  const rs = await db.execute({ sql: "SELECT * FROM newtab_templates WHERE id = ?", args: [id] });
  const row = rs.rows[0];
  return row ? rowToTemplate(row as unknown as Record<string, unknown>) : null;
}

/** The one active template row (the table is source of truth; the settings
 *  row's active_template_id is a read mirror), or null if none is set. */
export async function getActiveNewTabTemplate(db: Db): Promise<NewTabTemplate | null> {
  const rs = await db.execute("SELECT * FROM newtab_templates WHERE is_active = 1 LIMIT 1");
  const row = rs.rows[0];
  return row ? rowToTemplate(row as unknown as Record<string, unknown>) : null;
}

export interface UpdateNewTabTemplatePatch {
  name?: string;
  html?: string;
  config?: NewTabTemplateConfig;
}

/**
 * Apply a partial update. Preset rows are read-only (§4.3.1): throws
 * TemplatePresetReadOnlyError so the route can 409. `config` here is the
 * ALREADY-MERGED full config (the caller merges partials against the current
 * row); confusion about config-merge semantics must not reach SQL.
 */
export async function updateNewTabTemplate(
  db: Db,
  id: string,
  patch: UpdateNewTabTemplatePatch,
): Promise<NewTabTemplate | null> {
  const current = await getNewTabTemplate(db, id);
  if (!current) return null;
  if (current.isPreset) throw new TemplatePresetReadOnlyError(id);

  const sets: string[] = ["updated_at = ?"];
  const args: (string | number)[] = [new Date().toISOString()];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.html !== undefined) {
    sets.push("html = ?");
    args.push(patch.html);
  }
  if (patch.config !== undefined) {
    sets.push("config_json = ?");
    args.push(JSON.stringify(patch.config));
  }
  args.push(id);
  await db.execute({
    sql: `UPDATE newtab_templates SET ${sets.join(", ")} WHERE id = ? AND is_preset = 0`,
    args,
  });
  return getNewTabTemplate(db, id);
}

/** `is_preset` rows refuse PATCH/DELETE — they are reference implementations,
 *  not user data. Carries a stable code so routes can 409 without string match. */
export class TemplatePresetReadOnlyError extends Error {
  constructor(id: string) {
    super(`Template ${id} is a built-in preset and is read-only`);
    this.name = "TemplatePresetReadOnlyError";
  }
}

/**
 * The is_active invariant, §4.2.1: deactivate everything, activate one, mirror
 * the choice into newtab_settings — one transaction. Settings key param lets
 * open mode collapse to "local" (same convention as user_settings).
 * `mirrorSettings: false` skips the settings-row write — preset SEEDING uses
 * this so the settings row's absence stays the "hasn't seen the wizard yet"
 * marker (§4.6); only a deliberate user/agent choice writes it.
 */
export async function activateNewTabTemplate(
  db: Db,
  id: string,
  settingsKey: string = "local",
  opts?: { mirrorSettings?: boolean },
): Promise<NewTabTemplate | null> {
  const target = await getNewTabTemplate(db, id);
  if (!target) return null;
  const now = new Date().toISOString();
  const statements: (string | { sql: string; args: (string | number)[] })[] = [
    "UPDATE newtab_templates SET is_active = 0",
    { sql: "UPDATE newtab_templates SET is_active = 1, updated_at = ? WHERE id = ?", args: [now, id] },
  ];
  if (opts?.mirrorSettings !== false) {
    statements.push({
      sql: `INSERT INTO newtab_settings (user_id, active_template_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              active_template_id = excluded.active_template_id,
              updated_at = excluded.updated_at`,
      args: [settingsKey, id, now],
    });
  }
  await db.batch(statements, "write");
  return getNewTabTemplate(db, id);
}

/**
 * Delete a template. Presets refuse (409 via TemplatePresetReadOnlyError). If
 * the deleted row was ACTIVE, activate the first remaining preset (§4.3.1 —
 * never leave a user with no active template; presets are guaranteed because
 * they can't be deleted). Returns false when the id doesn't exist.
 */
export async function deleteNewTabTemplate(
  db: Db,
  id: string,
  settingsKey: string = "local",
): Promise<boolean> {
  const current = await getNewTabTemplate(db, id);
  if (!current) return false;
  if (current.isPreset) throw new TemplatePresetReadOnlyError(id);

  await db.execute({ sql: "DELETE FROM newtab_templates WHERE id = ?", args: [id] });
  if (current.isActive) {
    const fallback = await db.execute(
      "SELECT id FROM newtab_templates WHERE is_preset = 1 ORDER BY updated_at ASC LIMIT 1",
    );
    const fallbackId = fallback.rows[0]?.id;
    if (fallbackId) await activateNewTabTemplate(db, String(fallbackId), settingsKey);
  }
  return true;
}

/** The settings row for a user/settings key, or null when never written — the
 *  "seen the wizard" marker (§4.6: the wizard renders while there's no row). */
export async function getNewTabSettings(db: Db, key: string): Promise<NewTabSettings | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM newtab_settings WHERE user_id = ?",
    args: [key],
  });
  const row = rs.rows[0];
  return row ? rowToSettings(row as unknown as Record<string, unknown>) : null;
}

/** Partial upsert of launcher position / sidebar collapse — same semantics as
 *  upsertUserSettings: present keys write, absent keys keep. */
export async function upsertNewTabSettings(
  db: Db,
  key: string,
  patch: { launcherPosition?: "bottom-left" | "bottom-right"; sidebarCollapsed?: boolean },
): Promise<NewTabSettings> {
  const now = new Date().toISOString();
  const cols: string[] = [];
  const values: (string | number)[] = [];
  const conflictSets: string[] = [];
  if (patch.launcherPosition !== undefined) {
    cols.push("launcher_position");
    values.push(patch.launcherPosition);
    conflictSets.push("launcher_position = excluded.launcher_position");
  }
  if (patch.sidebarCollapsed !== undefined) {
    cols.push("sidebar_collapsed");
    values.push(patch.sidebarCollapsed ? 1 : 0);
    conflictSets.push("sidebar_collapsed = excluded.sidebar_collapsed");
  }
  await db.execute({
    sql: `INSERT INTO newtab_settings (user_id, updated_at${cols.length ? `, ${cols.join(", ")}` : ""})
          VALUES (?, ?${cols.map(() => ", ?").join("")})
          ON CONFLICT(user_id) DO UPDATE SET
            ${["updated_at = excluded.updated_at", ...conflictSets].join(", ")}`,
    args: [key, now, ...values],
  });
  const saved = await getNewTabSettings(db, key);
  if (!saved) throw new Error("upsertNewTabSettings: row not found after upsert");
  return saved;
}

function rowToTemplate(row: Record<string, unknown>): NewTabTemplate {
  let config: NewTabTemplateConfig = { launcherPosition: "bottom-right", thumbnail: "favorites" };
  try {
    // Validate loosely: a row with a hand-edited/degenerate config still
    // renders — the schema's defaults fill whatever parse strips.
    const parsed = JSON.parse(String(row.config_json ?? "{}"));
    if (parsed && typeof parsed === "object") config = { ...config, ...parsed };
  } catch {
    // keep defaults
  }
  return {
    id: String(row.id),
    name: String(row.name),
    html: String(row.html),
    config,
    isPreset: Boolean(Number(row.is_preset)),
    isActive: Boolean(Number(row.is_active)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSettings(row: Record<string, unknown>): NewTabSettings {
  const pos = String(row.launcher_position ?? "bottom-right");
  return {
    activeTemplateId: row.active_template_id == null ? null : String(row.active_template_id),
    launcherPosition: pos === "bottom-left" ? "bottom-left" : "bottom-right",
    sidebarCollapsed: Boolean(Number(row.sidebar_collapsed)),
    updatedAt: String(row.updated_at),
  };
}
