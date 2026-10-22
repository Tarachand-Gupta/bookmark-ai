import { describe, expect, it } from "vitest";
import { exportBundleSchema, migrateExportBundle, SCHEMA_VERSION } from "@bookmark-ai/types";

const v4 = () => ({
  schemaVersion: 4,
  exportedAt: "2026-08-01T00:00:00.000Z",
  counts: { bookmarks: 1, sessions: 1, conversations: 0 },
  bookmarks: [
    {
      url: "https://example.com/a",
      title: "A",
      description: null,
      category: "Development",
      tags: ["a"],
      browser: "chrome",
      device: "laptop",
      deviceName: null,
      os: "macOS",
      domain: "example.com",
      ogJson: "{}",
      savedAt: "2026-07-01T00:00:00.000Z",
      savedDay: "2026-07-01",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  sessions: [
    {
      name: "Research",
      tabs: [{ url: "https://example.com", title: "Example" }],
      tabCount: 1,
      browser: "chrome",
      device: "laptop",
      os: "macOS",
      description: "Looking at examples",
      savedAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  conversations: [],
});

describe("export bundle v5", () => {
  it("SCHEMA_VERSION is 6", () => {
    expect(SCHEMA_VERSION).toBe(6);
  });

  it("upgrades a v4 bundle: skills: [] and counts.skills: 0, everything else intact", () => {
    const out = migrateExportBundle(v4());
    expect(out.schemaVersion).toBe(6);
    expect(out.skills).toEqual([]);
    expect(out.counts).toEqual({ bookmarks: 1, sessions: 1, conversations: 0, skills: 0 });
    expect(out.bookmarks).toHaveLength(1);
    expect(out.sessions[0].description).toBe("Looking at examples");
  });

  it("chains v1 → v5 (conversations and skills both defaulted)", () => {
    const { conversations: _c, ...rest } = v4();
    const v1 = { ...rest, schemaVersion: 1, counts: { bookmarks: 1, sessions: 1 } };
    // v1 sessions had no os/description keys either.
    v1.sessions = v1.sessions.map(({ os: _o, description: _d, ...s }) => s) as typeof v1.sessions;
    const out = migrateExportBundle(v1);
    expect(out.schemaVersion).toBe(6);
    expect(out.conversations).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.sessions[0].os).toBeNull();
    expect(out.sessions[0].description).toBeNull();
    expect(out.counts).toMatchObject({ conversations: 0, skills: 0 });
  });

  it("accepts a v5 bundle with skills and validates their shape", () => {
    const bundle = {
      ...v4(),
      schemaVersion: 5,
      counts: { ...v4().counts, skills: 1 },
      skills: [
        {
          name: "Weekly reading digest",
          description: "Summarise the week",
          instructions: "Group by theme…",
          enabled: true,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-02T00:00:00.000Z",
        },
      ],
    };
    const out = migrateExportBundle(bundle);
    expect(out.skills).toHaveLength(1);
    expect(out.skills[0].name).toBe("Weekly reading digest");
  });

  it("rejects an oversized skill and a newer-than-supported version", () => {
    const bad = {
      ...v4(),
      schemaVersion: 5,
      skills: [
        {
          name: "x",
          description: "",
          instructions: "y".repeat(32_001),
          enabled: true,
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    };
    expect(() => migrateExportBundle(bad)).toThrow(/Invalid export bundle/);
    expect(() => migrateExportBundle({ ...v4(), schemaVersion: 7 })).toThrow(
      /newer than supported/,
    );
  });

  it("the schema itself defaults skills to [] for pre-v5 shapes", () => {
    const parsed = exportBundleSchema.parse({ ...v4(), schemaVersion: 5 });
    expect(parsed.skills).toEqual([]);
  });
});

describe("v6 export query budget", () => {
  it("round trips 5,000 bookmarks and frozen chat context with constant export queries", async () => {
    const { createClient } = await import("@libsql/client");
    const { ensureSchema, insertConversation, insertMessage, getBookmarkByUrl, getBookmarkOrganization } = await import("@bookmark-ai/db");
    const { exportUserData, importUserData, executeOrganizationOperation, editBookmark, persistTurnContext, resolveChatContext, loadConversationRecord } = await import("@bookmark-ai/engine");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "bookmark-export-budget-"));
    const source = createClient({url:`file:${join(dir,"source.db")}`});
    const target = createClient({url:`file:${join(dir,"target.db")}`});
    const stamp = "2026-10-01T12:00:00.000Z";
    try {
      await ensureSchema(source); await ensureSchema(target);
      await source.execute({sql:`WITH RECURSIVE rows(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM rows WHERE n<4999)
        INSERT INTO bookmarks(id,url,domain,title,saved_at,saved_day,created_at)
        SELECT 'export-'||n,'https://export.invalid/'||n,'export.invalid','Saved article '||n,?,'2026-10-01',? FROM rows`,args:[stamp,stamp]});
      const folder = await executeOrganizationOperation(source,{operationId:crypto.randomUUID(),action:"folder.create",name:"Manual folder"});
      await editBookmark(source,"export-0",{operationId:crypto.randomUUID(),changes:{title:"A manually chosen title",folderId:folder.entityId!,readingState:"read",tags:[]}});
      for(let i=0;i<40;i++) {
        await insertConversation(source,{id:`conversation-${i}`,title:`Research ${i}`,createdAt:stamp,updatedAt:stamp});
        await insertMessage(source,{id:`message-${i}`,conversationId:`conversation-${i}`,role:"user",parts:[{type:"text",text:"Compare these sources"}],createdAt:stamp});
        await persistTurnContext(source,`conversation-${i}`,`message-${i}`,await resolveChatContext(source,{type:"bookmarks",bookmarkIds:["export-0","missing"]}));
      }
      const execute = source.execute.bind(source); let queries=0;
      source.execute = ((...args: Parameters<typeof source.execute>)=>{queries++;return execute(...args);}) as typeof source.execute;
      const bundle=await exportUserData(source,stamp);
      expect(queries).toBeLessThanOrEqual(8);
      expect(bundle.schemaVersion).toBe(6);expect(bundle.bookmarks).toHaveLength(5000);expect(bundle.conversations).toHaveLength(40);
      expect(bundle.bookmarks.find(b=>b.url==="https://export.invalid/0")).toMatchObject({title:"A manually chosen title",readingState:"read",folderId:folder.entityId,manualOverrides:{title:true}});
      expect(bundle.bookmarks.find(b=>b.url==="https://export.invalid/4999")).toMatchObject({folderId:null,readingState:"not_on_list",manualOverrides:{}});
      expect(bundle.bookmarks.find(b=>b.url==="https://export.invalid/4999")!.manualOverrides).toEqual({});
      expect(bundle.conversations[0].messages[0]).toMatchObject({context:{type:"bookmarks"},contextBookmarkIds:["export-0"],contextSources:[{id:"export-0"}],unavailableContext:[{id:"missing"}],createdAt:stamp});
      await importUserData(target,bundle);
      expect(Number((await target.execute("SELECT COUNT(*) AS n FROM bookmarks")).rows[0].n)).toBe(5000);
      const restored=await getBookmarkByUrl(target,"https://export.invalid/0");
      expect(restored).toMatchObject({title:"A manually chosen title",readingState:"read",tags:[],createdAt:stamp});
      expect((await getBookmarkOrganization(target,restored!.id)).overrides.title).toBe(true);
      expect((await loadConversationRecord(target,"conversation-0"))?.messages).toEqual((await loadConversationRecord(source,"conversation-0"))?.messages);
    } finally {source.close();target.close();rmSync(dir,{recursive:true,force:true});}
  },60000);
});
