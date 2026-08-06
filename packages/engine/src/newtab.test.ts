import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  activateNewTabTemplate,
  createDb,
  getNewTabSettings,
  insertBookmark,
  listNewTabTemplates,
  runMigrations,
  TemplatePresetReadOnlyError,
  TENANT_MIGRATIONS,
} from "@bookmark-ai/db";
import {
  ensureNewTabPresets,
  exportUserData,
  getWizardData,
  importUserData,
  saveNewTabTemplate,
} from "./index";
import { NEWTAB_PRESETS } from "./newtab-presets";
import { migrateExportBundle } from "@bookmark-ai/types";

/**
 * Engine-level tests for New Tab Canvas (docs/features/newtab-canvas.md):
 * preset seeding/refresh, the template save path (create/patch/merge),
 * read-only presets, the activate invariant, delete-active fallback, the
 * wizard derivations, and the export/import round trip. Runs against real
 * libSQL file DBs in a tmp dir — no mocks.
 */

const dir = mkdtempSync(join(tmpdir(), "newtab-engine-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function tenantDb(name: string) {
  const db = createDb(`file:${join(dir, name)}.db`);
  await runMigrations(db, TENANT_MIGRATIONS);
  return db;
}

const HTML = "<!doctype html><html><head><title>Board</title></head><body>hi</body></html>";

describe("preset seeding & refresh", () => {
  it("seeds 6 presets on empty, activates favorites table-level, writes NO settings row", async () => {
    const db = await tenantDb("seed");
    await ensureNewTabPresets(db);
    const templates = await listNewTabTemplates(db);
    expect(templates.length).toBe(6);
    expect(templates.every((t) => t.isPreset)).toBe(true);
    expect(templates.filter((t) => t.isActive).map((t) => t.id)).toEqual(["preset:favorites"]);
    // The settings row's absence is the "first run" marker for the wizard.
    expect(await getNewTabSettings(db, "user_x")).toBeNull();
  });

  it("is idempotent and REFRESHES stale preset bodies without touching is_active", async () => {
    const db = await tenantDb("refresh");
    await ensureNewTabPresets(db);
    await activateNewTabTemplate(db, "preset:most-used", "user_x");
    // Simulate an old deploy's stale preset row.
    await db.execute("UPDATE newtab_templates SET html = '<b>stale</b>' WHERE id = 'preset:recent'");
    await ensureNewTabPresets(db);
    const templates = await listNewTabTemplates(db);
    expect(templates.length).toBe(6);
    expect(templates.find((t) => t.id === "preset:recent")!.html).toBe(
      NEWTAB_PRESETS.find((p) => p.id === "preset:recent")!.html,
    );
    // Activation untouched by the refresh.
    expect(templates.filter((t) => t.isActive).map((t) => t.id)).toEqual(["preset:most-used"]);
    // Settings mirror from the earlier explicit activation still intact.
    expect((await getNewTabSettings(db, "user_x"))?.activeTemplateId).toBe("preset:most-used");
  });
});

describe("saveNewTabTemplate", () => {
  it("creates activated + mirrors the settings row; derives the name from <title>", async () => {
    const db = await tenantDb("create");
    await ensureNewTabPresets(db);
    const created = await saveNewTabTemplate(db, "user_x", { html: HTML });
    expect(created).not.toBeNull();
    expect(created!.name).toBe("Board");
    expect(created!.isActive).toBe(true);
    expect((await listNewTabTemplates(db)).filter((t) => t.isActive)).toHaveLength(1);
    expect((await getNewTabSettings(db, "user_x"))?.activeTemplateId).toBe(created!.id);
  });

  it("partial config patch MERGES over the current config", async () => {
    const db = await tenantDb("patch");
    await ensureNewTabPresets(db);
    const created = await saveNewTabTemplate(db, "user_x", {
      html: HTML,
      config: { launcherPosition: "bottom-left" },
    });
    const patched = await saveNewTabTemplate(db, "user_x", {
      templateId: created!.id,
      config: { thumbnail: "recent" },
    });
    expect(patched!.config.thumbnail).toBe("recent");
    expect(patched!.config.launcherPosition).toBe("bottom-left");
  });

  it("presets refuse give-and-take: PATCH and DELETE both throw the 409 class", async () => {
    const db = await tenantDb("preset-guard");
    await ensureNewTabPresets(db);
    await expect(
      saveNewTabTemplate(db, "user_x", { templateId: "preset:recent", name: "hijack" }),
    ).rejects.toBeInstanceOf(TemplatePresetReadOnlyError);
    const { deleteNewTabTemplate } = await import("@bookmark-ai/db");
    await expect(deleteNewTabTemplate(db, "preset:recent")).rejects.toBeInstanceOf(
      TemplatePresetReadOnlyError,
    );
  });

  it("deleting the ACTIVE custom re-activates a preset (never leaves none active)", async () => {
    const db = await tenantDb("fallback");
    await ensureNewTabPresets(db);
    const { deleteNewTabTemplate } = await import("@bookmark-ai/db");
    const created = await saveNewTabTemplate(db, "user_x", { html: HTML });
    expect(await deleteNewTabTemplate(db, created!.id, "user_x")).toBe(true);
    const actives = (await listNewTabTemplates(db)).filter((t) => t.isActive);
    expect(actives).toHaveLength(1);
    expect(actives[0]!.isPreset).toBe(true);
    expect((await getNewTabSettings(db, "user_x"))?.activeTemplateId).toBe(actives[0]!.id);
  });
});

describe("wizard derivations", () => {
  it("favorites prefer tagged bookmarks; mostUsed ranks by saved count; timeSpent is honest", async () => {
    const db = await tenantDb("wizard");
    await ensureNewTabPresets(db);
    const now = new Date().toISOString();
    const add = (url: string, domain: string, tags: string[]) =>
      insertBookmark(db, {
        id: `b-${url}`,
        url,
        domain,
        title: `T ${url}`,
        description: null,
        og: {},
        source: { browser: "chrome", device: "laptop", deviceName: null, os: null, savedAt: now },
        category: "dev",
        tags,
        createdAt: now,
      });
    await add("https://a.com/1", "a.com", ["favorite"]);
    await add("https://a.com/2", "a.com", ["favorite"]);
    await add("https://b.com/1", "b.com", []);

    const wiz = await getWizardData(db, "user_x");
    expect(wiz.favorites.filter((f) => f.domain === "a.com")).toHaveLength(2);
    expect(wiz.recent).toHaveLength(3);
    expect(wiz.mostUsed[0]).toEqual({ domain: "a.com", count: 2 });
    expect(wiz.continueWhereYouLeft.enabled).toBe(false); // live sharing off
    expect(wiz.workingOn.enabled).toBe(false);
    expect(wiz.timeSpent).toEqual({ available: false });
  });
});

describe("export/import round trip (SCHEMA_VERSION 4)", () => {
  it("exports customs only (presets excluded), re-imports idempotently, re-normalizes active", async () => {
    const db = await tenantDb("roundtrip-src");
    await ensureNewTabPresets(db);
    const created = await saveNewTabTemplate(db, "user_x", { html: HTML });
    const bundle = await exportUserData(db, new Date().toISOString());
    expect(bundle.schemaVersion).toBe(4);
    expect(bundle.newtabTemplates).toHaveLength(1);
    expect(bundle.newtabTemplates[0]!.id).toBe(created!.id);

    const db2 = await tenantDb("roundtrip-dst");
    await ensureNewTabPresets(db2);
    const first = await importUserData(db2, bundle, { userId: "user_y" });
    expect(first.newtabTemplates).toBe(1);
    const twice = await importUserData(db2, bundle, { userId: "user_y" });
    expect(twice.newtabTemplates).toBe(1);
    const dstRows = await db2.execute("SELECT COUNT(*) c FROM newtab_templates WHERE is_preset = 0");
    expect(Number(dstRows.rows[0]!.c)).toBe(1);
    // The exported ACTIVE custom template re-normalizes against seeded presets.
    const actives = (await listNewTabTemplates(db2)).filter((t) => t.isActive);
    expect(actives.map((t) => t.id)).toEqual([created!.id]);
    expect((await getNewTabSettings(db2, "user_y"))?.activeTemplateId).toBe(created!.id);
  });

  it("v1 bundles upgrade cleanly with defaulted arrays", () => {
    const upgraded = migrateExportBundle({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      counts: { bookmarks: 0, sessions: 0 },
      bookmarks: [],
      sessions: [],
    });
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.conversations).toEqual([]);
    expect(upgraded.newtabTemplates).toEqual([]);
  });
});
