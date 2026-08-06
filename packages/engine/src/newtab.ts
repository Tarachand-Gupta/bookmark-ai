import { randomUUID } from "node:crypto";
import {
  activateNewTabTemplate,
  getNewTabTemplate,
  insertNewTabTemplate,
  listBookmarks,
  listNewTabTemplates,
  seedNewTabPresets,
  updateNewTabTemplate,
} from "@bookmark-ai/db";
import type { Db } from "@bookmark-ai/db";
import {
  newTabTemplateConfigSchema,
  type NewTabTemplate,
  type NewTabTemplateConfig,
  type NewTabWizardData,
  type WizardBookmark,
} from "@bookmark-ai/types";
import { listLiveDevices } from "./live-sessions";
import { NEWTAB_PRESETS } from "./newtab-presets";

/**
 * New Tab Canvas engine (docs/features/newtab-canvas.md §4.3.1/§4.5.1): the
 * template save path shared by the REST route AND the agent's
 * writeNewTabTemplate tool (one code path, one validation), preset seeding,
 * and the read-only "wizard feature" derivations over existing data.
 */

/** Open/self-host mode has no Clerk user; collapse to the `local` sentinel
 *  (same convention as user_settings / live_settings). */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

/** A template name the caller didn't supply: prefer the page's own <title>,
 *  else a neutral label. Cheap regex — the input is an HTML doc we wrote. */
function deriveTemplateName(html: string): string {
  const m = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(html);
  const title = m?.[1]?.trim();
  return title && title.length > 0 ? title : "My tab";
}

export interface SaveNewTabTemplateInput {
  name?: string;
  /** Required when creating; optional when updating an existing template. */
  html?: string;
  config?: Partial<NewTabTemplateConfig>;
  templateId?: string;
  activate?: boolean;
}

/**
 * Create-or-update a template. `templateId` present → PATCH that template
 * (must be a non-preset; TemplatePresetReadOnlyError propagates so the route
 * can 409); absent → create (and, unless `activate === false`, activate).
 * Returns `{ template }` or null when templateId doesn't exist.
 */
export async function saveNewTabTemplate(
  db: Db,
  userId: string | null,
  input: SaveNewTabTemplateInput,
): Promise<NewTabTemplate | null> {
  const key = settingsKey(userId);

  if (input.templateId) {
    const current = await getNewTabTemplate(db, input.templateId);
    if (!current) return null;
    const config = newTabTemplateConfigSchema.parse({ ...current.config, ...input.config });
    const updated = await updateNewTabTemplate(db, input.templateId, {
      name: input.name,
      html: input.html,
      config,
    });
    if (updated && input.activate !== false && !updated.isActive) {
      return activateNewTabTemplate(db, updated.id, key);
    }
    return updated;
  }

  const config = newTabTemplateConfigSchema.parse(input.config ?? {});
  if (!input.html) throw new Error("saveNewTabTemplate: html is required when creating");
  const id = randomUUID();
  await insertNewTabTemplate(db, {
    id,
    name: input.name ?? deriveTemplateName(input.html),
    html: input.html,
    config,
    isPreset: false,
  });
  // Activation (and its settings mirror) runs HERE — the engine owns the
  // settings-key context; the query layer's insert is key-agnostic.
  if (input.activate !== false) {
    const activated = await activateNewTabTemplate(db, id, key);
    if (activated) return activated;
  }
  const created = await getNewTabTemplate(db, id);
  if (!created) throw new Error("saveNewTabTemplate: row not found after insert");
  return created;
}

/**
 * Seed the six presets on the FIRST templates read of an empty table (§4.6).
 * Idempotent (INSERT OR IGNORE on stable ids) and marks preset:favorites the
 * table-level active WITHOUT writing newtab_settings — the settings row's
 * absence is what makes the first-run wizard render.
 */
export async function seedPresetsIfEmpty(db: Db): Promise<void> {
  const existing = await listNewTabTemplates(db);
  if (existing.length > 0) return;
  await seedNewTabPresets(db, NEWTAB_PRESETS);
  await activateNewTabTemplate(db, NEWTAB_PRESETS[0]!.id, settingsKey(null), {
    mirrorSettings: false,
  });
}

function toWizardBookmark(b: {
  url: string;
  title: string;
  domain: string;
  category: string;
  tags: string[];
  source: { savedAt: string };
}): WizardBookmark {
  return {
    url: b.url,
    title: b.title,
    domain: b.domain,
    category: b.category,
    tags: b.tags,
    savedAt: b.source.savedAt,
  };
}

/**
 * All six "wizard features" in ONE fan-out (§4.5.1 — the new tab is a cold
 * open; one hop beats six). Every section is a read-only derivation over
 * existing tables; nothing here is stored.
 *  - favorites: bookmarks tagged `favorite` (the convention), filled out with
 *    recent saves when that's sparse — we have no visit counter and URLs are
 *    unique per row, so a GROUP-BY-url signal can't exist (§7 of the design).
 *  - continueWhereYouLeft / workingOn: the tenant's live_devices rows, via the
 *    existing live-sessions engine read; {enabled:false} when sharing is off.
 *  - mostUsed: domains ranked by saved count.
 *  - timeSpent: honest {available:false} — we do not track time-on-page.
 */
export async function getWizardData(db: Db, userId: string | null): Promise<NewTabWizardData> {
  const recent = await listBookmarks(db, { limit: 24, offset: 0 });

  // Favorites: tagged convention first, then fill with recent. De-dupe by url.
  let favorites = await listBookmarks(db, { tag: "favorite", limit: 24, offset: 0 });
  if (favorites.bookmarks.length < 12) {
    const seen = new Set(favorites.bookmarks.map((b) => b.url));
    const fill = recent.bookmarks.filter((b) => !seen.has(b.url));
    favorites = { ...favorites, bookmarks: [...favorites.bookmarks, ...fill].slice(0, 24) };
  }

  const live = await listLiveDevices(db, userId);
  const liveDevices = live.enabled
    ? live.devices.slice(0, 4).map((d) => ({
        label: d.label || d.browser,
        browser: d.browser,
        tabs: d.windows
          .flatMap((w) => w.tabs.map((t) => ({ title: t.title ?? t.url, url: t.url })))
          .slice(0, 15),
      }))
    : [];

  const mostUsedRows = await db.execute(
    "SELECT domain, COUNT(*) AS c FROM bookmarks GROUP BY domain ORDER BY c DESC LIMIT 20",
  );

  return {
    favorites: favorites.bookmarks.slice(0, 24).map(toWizardBookmark),
    recent: recent.bookmarks.slice(0, 24).map(toWizardBookmark),
    continueWhereYouLeft: live.enabled
      ? { enabled: true, device: liveDevices[0] ?? null }
      : { enabled: false },
    workingOn: live.enabled ? { enabled: true, devices: liveDevices } : { enabled: false },
    mostUsed: mostUsedRows.rows.map((r) => ({
      domain: String(r.domain),
      count: Number(r.c),
    })),
    timeSpent: { available: false },
  };
}
