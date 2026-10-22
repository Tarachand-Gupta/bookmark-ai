import { persistTurnContext, type ResolvedChatContext } from "./composer-context";
import { randomUUID } from "node:crypto";
import {
  createSession,
  getBookmarkOrganization,
  putBookmarkOrganization,
  organizationFolders,
  organizationLabels,
  ensureImportFolderPath,
  canonicalLabel,
  putLabel,
  normalizeOrganizationName,
  getBookmarkByUrl,
  getSkillByName,
  insertBookmark,
  insertConversation,
  insertMessage,
  insertSkill,
  listConversations,
  json,
  listSkills,
  updateSkill,
  type Db,
} from "@bookmark-ai/db";
import {
  migrateExportBundle,
  SCHEMA_VERSION,
  type Browser,
  type DeviceType,
  type ExportBundle,
  type ExportedBookmark,
  type ExportedConversation,
  type ExportedSession,
  type ExportedSkill,
  type OpenGraph,
  type SessionTab,
} from "@bookmark-ai/types";

/** Options for {@link importUserData}. Reserved for future tuning (none yet). */
export type ImportUserDataOptions = Record<string, never>;

/**
 * Export every bookmark and session in a tenant DB as a versioned, lossless
 * bundle. Reads ALL rows (no list caps) and every persisted column EXCEPT the
 * `embedding` blob — that is regenerable and left out to keep bundles small.
 * `exportedAt` is passed in by the caller (some runtimes lack a stable clock
 * at call sites; the route stamps it). Timestamps are copied verbatim.
 */
export async function exportUserData(db: Db, exportedAt: string): Promise<ExportBundle> {
  const [bookmarkRows, sessionRows] = await Promise.all([
    db.execute(`
      SELECT b.url, b.domain, b.title, b.description, b.og_json, b.browser, b.device,
             b.device_name, b.os, b.saved_at, b.saved_day, b.category, b.tags_json, b.created_at,
             o.folder_id, o.reading_state, o.overrides_json
      FROM bookmarks b LEFT JOIN bookmark_organization o ON o.bookmark_id = b.id
      ORDER BY b.created_at ASC
    `),
    db.execute(`
      SELECT name, tabs_json, tab_count, browser, device, os, description, saved_at, created_at
      FROM sessions
      ORDER BY created_at ASC
    `),
  ]);

  const bookmarks: ExportedBookmark[] = bookmarkRows.rows.map((r) => ({
      folderId: (r.folder_id as string | null) ?? null,
      readingState: (r.reading_state as ExportedBookmark["readingState"]) ?? "not_on_list",
      manualOverrides: json<ExportedBookmark["manualOverrides"]>(r.overrides_json, {}) ?? {},
      url: String(r.url),
      title: String(r.title),
      description: (r.description as string | null) ?? null,
      category: String(r.category),
      tags: parseStringArray(r.tags_json),
      browser: String(r.browser),
      device: String(r.device),
      deviceName: (r.device_name as string | null) ?? null,
      os: (r.os as string | null) ?? null,
      domain: String(r.domain),
      ogJson: (r.og_json as string | null) ?? "{}",
      savedAt: String(r.saved_at),
      savedDay: String(r.saved_day),
      createdAt: String(r.created_at),
    }));

  const sessions: ExportedSession[] = sessionRows.rows.map((r) => ({
    name: String(r.name),
    tabs: parseTabs(r.tabs_json),
    tabCount: Number(r.tab_count ?? 0),
    browser: String(r.browser),
    device: String(r.device),
    os: (r.os as string | null) ?? null,
    // v4: the AI summary of the window of tabs.
    description: (r.description as string | null) ?? null,
    savedAt: String(r.saved_at),
    createdAt: String(r.created_at),
  }));

  // Read messages and frozen turn contexts once for the entire tenant. Export
  // already materializes the full bundle; per-conversation loads add latency
  // without reducing memory and used to read every message twice.
  const [conversationRows, messageRows] = await Promise.all([
    listConversations(db),
    db.execute(`SELECT m.id, m.conversation_id, m.role, m.parts_json, m.created_at, t.context_json
      FROM chat_messages m LEFT JOIN chat_turn_contexts t
        ON t.conversation_id = m.conversation_id AND t.message_id = m.id
      ORDER BY m.created_at ASC`),
  ]);
  const messagesByConversation = new Map<string, ExportedConversation["messages"]>();
  for (const row of messageRows.rows) {
    const context = json<ResolvedChatContext | null>(row.context_json, null);
    const parts = json<unknown>(row.parts_json, []);
    const message: ExportedConversation["messages"][number] = {
      id: String(row.id), role: String(row.role),
      parts: Array.isArray(parts) ? parts : [], createdAt: String(row.created_at),
      ...(context ? { context: context.context, contextBookmarkIds: context.bookmarkIds,
        contextSources: context.sources, unavailableContext: context.unavailable } : {}),
    };
    const conversationId = String(row.conversation_id);
    const messages = messagesByConversation.get(conversationId) ?? [];
    messages.push(message); messagesByConversation.set(conversationId, messages);
  }
  const conversations: ExportedConversation[] = conversationRows.map(c => ({
    id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
    messages: messagesByConversation.get(c.id) ?? [],
  }));

  // Skills (v5): the user's reusable Ask AI instructions, minus the per-DB id.
  const skills: ExportedSkill[] = (await listSkills(db)).map((s) => ({
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    enabled: s.enabled,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    counts: {
      bookmarks: bookmarks.length,
      sessions: sessions.length,
      conversations: conversations.length,
      skills: skills.length,
    },
    organization: {
      folders: (await organizationFolders(db)).map(({ id, name, parentId }) => ({
        id,
        name,
        parentId,
      })),
      labels: (await organizationLabels(db, true)).map(({ id, kind, name, deleted, aliasTo }) => ({
        id,
        kind,
        name,
        deleted,
        aliasTo,
      })),
    },
    bookmarks,
    sessions,
    conversations,
    skills,
  };
}

/**
 * Import a bundle produced by {@link exportUserData} into a tenant DB. The bundle
 * is validated and upgraded via `migrateExportBundle` first. Bookmarks upsert by
 * URL and sessions dedup by saved_at + name, so re-importing the same file is
 * idempotent. Original savedAt / savedDay / createdAt are preserved — nothing is
 * stamped "now" (that is the whole point of a lossless import). Uses the
 * lower-level `insertBookmark`/`createSession` query helpers, which take explicit
 * timestamps rather than generating them (unlike saveBookmarkFast/saveSession).
 * Embeddings are intentionally left null so the existing embed sweep refills them.
 * Returns how many of each were imported.
 */
export async function importUserData(
  db: Db,
  bundle: unknown,
  _opts?: ImportUserDataOptions,
): Promise<{ bookmarks: number; sessions: number; conversations: number; skills: number }> {
  const migrated = migrateExportBundle(bundle);

  const folderMap = new Map<string, string | null>();
  const visiting = new Set<string>();
  const paths = new Map<string, string[]>();
  const pathFor = (id: string): string[] => {
    const known = paths.get(id);
    if (known) return known;
    if (visiting.has(id)) throw new Error("Invalid export folder cycle");
    const folder = migrated.organization.folders.find((f) => f.id === id);
    if (!folder) throw new Error("Invalid export folder reference");
    visiting.add(id);
    const path = [...(folder.parentId ? pathFor(folder.parentId) : []), folder.name];
    visiting.delete(id);
    paths.set(id, path);
    return path;
  };
  // Validate the complete graph before writing any imported rows.
  for (const f of migrated.organization.folders) pathFor(f.id);
  for (const b of migrated.bookmarks)
    if (b.folderId && !paths.has(b.folderId))
      throw new Error("Invalid export bookmark folder reference");
  for (const f of migrated.organization.folders)
    folderMap.set(f.id, await ensureImportFolderPath(db, pathFor(f.id)));
  const labelMap = new Map<string, string>();
  for (const l of migrated.organization.labels.filter((l) => !l.deleted)) {
    const target = await canonicalLabel(db, l.kind, l.name);
    if (target) labelMap.set(l.id, target.id);
  }
  for (const l of migrated.organization.labels.filter((l) => l.deleted)) {
    const existing = (await organizationLabels(db, true)).find(
      (x) =>
        x.kind === l.kind &&
        normalizeOrganizationName(x.name) === normalizeOrganizationName(l.name),
    );
    if (!existing)
      await putLabel(db, {
        id: randomUUID(),
        kind: l.kind,
        name: l.name,
        deleted: true,
        aliasTo: l.aliasTo ? (labelMap.get(l.aliasTo) ?? null) : null,
        versions: {},
      });
  }
  let bookmarks = 0;
  for (const b of migrated.bookmarks) {
    // insertBookmark derives saved_day from source.savedAt.slice(0,10) — the
    // same rule that produced the exported savedDay, so it round-trips exactly.
    await insertBookmark(db, {
      id: randomUUID(),
      url: b.url,
      domain: b.domain,
      title: b.title,
      description: b.description,
      og: parseOpenGraph(b.ogJson),
      source: {
        browser: b.browser as Browser,
        device: b.device as DeviceType,
        deviceName: b.deviceName,
        os: b.os,
        savedAt: b.savedAt,
      },
      category: b.category,
      tags: b.tags,
      createdAt: b.createdAt,
    });
    const saved = await getBookmarkByUrl(db, b.url);
    if (saved) {
      const state = await getBookmarkOrganization(db, saved.id);
      state.folderId = b.folderId ? (folderMap.get(b.folderId) ?? null) : null;
      state.readingState = b.readingState;
      state.overrides = b.manualOverrides;
      state.versions = {
        title: randomUUID(),
        categoryId: randomUUID(),
        tags: randomUUID(),
        folderId: randomUUID(),
        readingState: randomUUID(),
      };
      await putBookmarkOrganization(db, saved.id, state);
    }
    bookmarks++;
  }

  let sessions = 0;
  for (const s of migrated.sessions) {
    // Sessions have no natural unique key like a bookmark's URL, so to keep
    // re-import idempotent (import the same file twice → no duplicates) we key
    // on saved_at + name: a millisecond timestamp plus name uniquely identifies
    // an exported session, so a re-import matches and skips the insert.
    const existing = await db.execute({
      sql: `SELECT id FROM sessions WHERE saved_at = ? AND name = ? LIMIT 1`,
      args: [s.savedAt, s.name],
    });
    if (existing.rows.length === 0) {
      await createSession(db, {
        id: randomUUID(),
        name: s.name,
        tabs: s.tabs,
        browser: s.browser,
        device: s.device,
        os: s.os,
        description: s.description,
        savedAt: s.savedAt,
        createdAt: s.createdAt,
      });
    }
    sessions++;
  }

  // Chat (v2): conversations + messages keep their original ids and timestamps.
  // insertConversation is INSERT OR IGNORE and insertMessage is INSERT OR
  // REPLACE, so re-importing the same bundle is idempotent (no duplicates).
  let conversations = 0;
  for (const c of migrated.conversations) {
    await insertConversation(db, {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
    for (const m of c.messages) {
      await insertMessage(db, {
        id: m.id,
        conversationId: c.id,
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt,
      });
      if (m.context) {
        await persistTurnContext(db, c.id, m.id, {
          context: m.context,
          bookmarkIds: m.contextBookmarkIds ?? (m.context.type === "library" ? null : []),
          sources: m.contextSources ?? [],
          unavailable: m.unavailableContext ?? [],
        });
      }
    }
    conversations++;
  }

  // Skills (v5): upsert by name, case-insensitively — the same uniqueness rule
  // the API enforces — so re-importing the same bundle is idempotent and an
  // export from another account merges onto matching names instead of 409ing.
  // Timestamps are preserved on insert; an update keeps the row's own created_at
  // and stamps the bundle's updated_at.
  let skills = 0;
  for (const s of migrated.skills) {
    const existing = await getSkillByName(db, s.name);
    if (existing) {
      await updateSkill(
        db,
        existing.id,
        {
          name: s.name,
          description: s.description,
          instructions: s.instructions,
          enabled: s.enabled,
        },
        s.updatedAt,
      );
    } else {
      await insertSkill(db, {
        id: randomUUID(),
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        enabled: s.enabled,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    skills++;
  }

  return { bookmarks, sessions, conversations, skills };
}

function parseStringArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseTabs(raw: unknown): SessionTab[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? (parsed as SessionTab[]) : [];
  } catch {
    return [];
  }
}

function parseOpenGraph(raw: string): OpenGraph {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OpenGraph) : {};
  } catch {
    return {};
  }
}

