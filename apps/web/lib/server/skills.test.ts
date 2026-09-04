import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, TENANT_MIGRATIONS, getUserSettings, upsertUserSettings, type Db } from "@bookmark-ai/db";
import {
  createSkill,
  createSkillForAgent,
  deleteSkill,
  exportUserData,
  getSkillRecord,
  importUserData,
  installSkillForAgent,
  listSkills,
  resolveSkillIndex,
  SkillNameConflictError,
  SkillNotFoundError,
  updateSkill,
  useSkillByName,
} from "@bookmark-ai/engine";
import {
  createSkillSchema,
  SKILL_MARKDOWN_TEMPLATE,
  SKILL_NAME_CONFLICT_MESSAGE,
  updateSkillSchema,
} from "@bookmark-ai/types";

/**
 * Skills end to end against a REAL in-memory libSQL DB running the actual
 * tenant migrations (so v14's DDL is exercised, including the ai_mode column):
 * schema validation, case-insensitive uniqueness, CRUD, the prompt index, the
 * useSkill lookup, and the export/import round trip.
 */

let db: Db;

beforeAll(async () => {
  db = createClient({ url: ":memory:" }) as unknown as Db;
  await runMigrations(db, TENANT_MIGRATIONS);
});
afterAll(() => {
  (db as unknown as { close(): void }).close();
});

describe("createSkillSchema", () => {
  const valid = { name: "Weekly digest", description: "Summarise my week", instructions: "Do it." };

  it("accepts a valid skill and defaults enabled to true", () => {
    expect(createSkillSchema.parse(valid)).toEqual({ ...valid, enabled: true });
  });

  it("trims name/description and rejects empties and over-length values", () => {
    expect(createSkillSchema.parse({ ...valid, name: "  Weekly digest  " }).name).toBe("Weekly digest");
    expect(createSkillSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(createSkillSchema.safeParse({ ...valid, name: "x".repeat(61) }).success).toBe(false);
    expect(createSkillSchema.safeParse({ ...valid, description: "" }).success).toBe(false);
    expect(createSkillSchema.safeParse({ ...valid, description: "x".repeat(201) }).success).toBe(false);
    expect(createSkillSchema.safeParse({ ...valid, instructions: "" }).success).toBe(false);
    expect(createSkillSchema.safeParse({ ...valid, instructions: "x".repeat(32_001) }).success).toBe(false);
  });

  it("restricts names to letters, digits, spaces, hyphens, underscores", () => {
    for (const ok of ["Link triage", "research-brief_2", "Résumé 日本"]) {
      expect(createSkillSchema.safeParse({ ...valid, name: ok }).success).toBe(true);
    }
    for (const bad of ["a/b", "hey!", "x:y", "<script>", "a.b"]) {
      expect(createSkillSchema.safeParse({ ...valid, name: bad }).success).toBe(false);
    }
  });

  it("updateSkillSchema accepts any subset", () => {
    expect(updateSkillSchema.parse({})).toEqual({});
    expect(updateSkillSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(updateSkillSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("skills CRUD (in-memory libSQL, real migrations)", () => {
  it("v14 landed: the skills table and user_settings.ai_mode exist", async () => {
    const versions = (await db.execute("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => Number(r.version));
    expect(versions).toContain(14);
    await upsertUserSettings(db, "local", { aiMode: "included" });
    expect((await getUserSettings(db, "local"))?.aiMode).toBe("included");
  });

  it("creates, lists newest-first, reads, updates, deletes", async () => {
    const a = await createSkill(db, { name: "Alpha", description: "first", instructions: "A", enabled: true });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createSkill(db, { name: "Beta", description: "second", instructions: "B", enabled: true });
    expect((await listSkills(db)).map((s) => s.name)).toEqual(["Beta", "Alpha"]);
    expect(await getSkillRecord(db, a.id)).toMatchObject({ name: "Alpha", enabled: true });

    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateSkill(db, a.id, { description: "first!", enabled: false });
    expect(updated).toMatchObject({ name: "Alpha", description: "first!", enabled: false, instructions: "A" });
    expect(updated.updatedAt > a.updatedAt).toBe(true);
    // The update bumped Alpha to the top.
    expect((await listSkills(db)).map((s) => s.name)).toEqual(["Alpha", "Beta"]);

    expect(await deleteSkill(db, b.id)).toBe(true);
    expect(await deleteSkill(db, b.id)).toBe(false);
    expect(await getSkillRecord(db, b.id)).toBeNull();
  });

  it("names are unique case-insensitively (create and rename), self-rename is fine", async () => {
    await expect(createSkill(db, { name: "alpha", description: "d", instructions: "i", enabled: true })).rejects.toBeInstanceOf(SkillNameConflictError);
    await expect(createSkill(db, { name: "ALPHA", description: "d", instructions: "i", enabled: true })).rejects.toThrow(SKILL_NAME_CONFLICT_MESSAGE);
    const gamma = await createSkill(db, { name: "Gamma", description: "d", instructions: "i", enabled: true });
    await expect(updateSkill(db, gamma.id, { name: "Alpha" })).rejects.toBeInstanceOf(SkillNameConflictError);
    expect((await updateSkill(db, gamma.id, { name: "GAMMA" })).name).toBe("GAMMA");
    await expect(updateSkill(db, "nope", { name: "x" })).rejects.toBeInstanceOf(SkillNotFoundError);
  });

  it("the prompt index lists ENABLED skills only, capped, with the true total", async () => {
    // Alpha is disabled from the update above; GAMMA is enabled.
    const index = await resolveSkillIndex(db);
    expect(index.skills.map((s) => s.name)).toEqual(["GAMMA"]);
    expect(index.total).toBe(1);
    await createSkill(db, { name: "Delta", description: "d", instructions: "i", enabled: true });
    const capped = await resolveSkillIndex(db, 1);
    expect(capped.skills).toHaveLength(1);
    expect(capped.total).toBe(2);
  });

  it("useSkillByName is case-insensitive and explains disabled/unknown", async () => {
    expect(await useSkillByName(db, "gamma")).toEqual({ name: "GAMMA", instructions: "i" });
    expect(await useSkillByName(db, "alpha")).toEqual({ error: 'Skill "Alpha" is disabled' });
    const unknown = await useSkillByName(db, "Zeta");
    expect("error" in unknown && unknown.error).toContain('No skill named "Zeta"');
    expect("error" in unknown && unknown.error).toContain("GAMMA");
    expect(await useSkillByName(db, "  ")).toEqual({ error: "Skill name is required" });
  });

  it("createSkill tool executor: validates, creates, and turns a conflict into {error} naming the clash", async () => {
    const made = await createSkillForAgent(db, {
      name: "Poet mode",
      description: "When the user says 'poet mode', answer in haiku",
      instructions: "Answer only in haiku (5-7-5).",
    });
    expect("skill" in made && made.skill).toMatchObject({ name: "Poet mode", description: "When the user says 'poet mode', answer in haiku" });
    expect("skill" in made && made.skill.id).toMatch(/^[0-9a-f-]{36}$/);

    const clash = await createSkillForAgent(db, { name: "poet MODE", description: "d", instructions: "i" });
    expect("error" in clash && clash.error).toContain('"poet MODE" already exists');
    expect("error" in clash && clash.error).toMatch(/different name/);

    const invalid = await createSkillForAgent(db, { name: "bad/name", description: "d", instructions: "i" });
    expect("error" in invalid && invalid.error).toMatch(/letters, digits, spaces, hyphens and underscores/);
  });

  it("installSkill tool executor: SSRF-blocked URL → {error}, never a throw", async () => {
    for (const url of ["http://127.0.0.1/SKILL.md", "http://169.254.169.254/latest/SKILL.md", "http://[::1]/SKILL.md"]) {
      const r = await installSkillForAgent(db, url);
      expect("error" in r && r.error).toMatch(/Couldn't fetch/);
    }
    expect(await installSkillForAgent(db, "ftp://example.com/SKILL.md")).toEqual({ error: "Only http(s) URLs can be installed" });
    expect(await installSkillForAgent(db, "javascript:alert(1)")).toEqual({ error: "Only http(s) URLs can be installed" });
  });

  it("installSkill tool executor: a fetched SKILL.md is parsed and created; bad markdown → {error}", async () => {
    const r = await installSkillForAgent(db, "https://example.com/skills/digest/SKILL.md", {
      fetchMarkdown: async () => SKILL_MARKDOWN_TEMPLATE,
    });
    expect("skill" in r && r.skill.name).toBe("Weekly reading digest");
    expect((await getSkillRecord(db, "skill" in r ? r.skill.id : ""))?.instructions).toContain("Group them into 3-6 themes");

    const again = await installSkillForAgent(db, "https://example.com/skills/digest/SKILL.md", {
      fetchMarkdown: async () => SKILL_MARKDOWN_TEMPLATE,
    });
    expect("error" in again && again.error).toContain('"Weekly reading digest" already exists');

    const bad = await installSkillForAgent(db, "https://example.com/README.md", {
      fetchMarkdown: async () => "just prose, no heading",
    });
    expect("error" in bad && bad.error).toMatch(/isn't a valid SKILL\.md/);

    const down = await installSkillForAgent(db, "https://example.com/SKILL.md", {
      fetchMarkdown: async () => {
        throw new Error("the URL answered HTTP 404");
      },
    });
    expect(down).toEqual({ error: "Couldn't fetch https://example.com/SKILL.md: the URL answered HTTP 404" });
  });

  it("export carries skills (v5) and import upserts them by name", async () => {
    const bundle = await exportUserData(db, "2026-09-03T00:00:00.000Z");
    expect(bundle.schemaVersion).toBe(5);
    expect(bundle.counts.skills).toBe(bundle.skills.length);
    expect(bundle.skills.map((s) => s.name).sort()).toEqual(["Alpha", "Delta", "GAMMA", "Poet mode", "Weekly reading digest"]);

    // A fresh DB imports them; a second import is idempotent.
    const other = createClient({ url: ":memory:" }) as unknown as Db;
    await runMigrations(other, TENANT_MIGRATIONS);
    const first = await importUserData(other, bundle);
    expect(first.skills).toBe(5);
    expect((await listSkills(other)).map((s) => s.name).sort()).toEqual(["Alpha", "Delta", "GAMMA", "Poet mode", "Weekly reading digest"]);
    const again = await importUserData(other, { ...bundle, skills: bundle.skills.map((s) => ({ ...s, name: s.name.toLowerCase(), description: "merged" })) });
    expect(again.skills).toBe(5);
    const merged = await listSkills(other);
    expect(merged).toHaveLength(5);
    expect(merged.every((s) => s.description === "merged")).toBe(true);
    (other as unknown as { close(): void }).close();
  });
});
