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
  it("SCHEMA_VERSION is 5", () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  it("upgrades a v4 bundle: skills: [] and counts.skills: 0, everything else intact", () => {
    const out = migrateExportBundle(v4());
    expect(out.schemaVersion).toBe(5);
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
    expect(out.schemaVersion).toBe(5);
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
    const bad = { ...v4(), schemaVersion: 5, skills: [{ name: "x", description: "", instructions: "y".repeat(32_001), enabled: true, createdAt: "t", updatedAt: "t" }] };
    expect(() => migrateExportBundle(bad)).toThrow(/Invalid export bundle/);
    expect(() => migrateExportBundle({ ...v4(), schemaVersion: 6 })).toThrow(/newer than supported/);
  });

  it("the schema itself defaults skills to [] for pre-v5 shapes", () => {
    const parsed = exportBundleSchema.parse({ ...v4(), schemaVersion: 5 });
    expect(parsed.skills).toEqual([]);
  });
});
