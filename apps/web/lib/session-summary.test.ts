import { describe, expect, it } from "vitest";
import {
  buildSessionSummaryPrompt,
  isAutoSessionName,
  parseSessionSummary,
  SESSION_DESCRIPTION_MAX,
  SESSION_NAME_MAX,
} from "@bookmark-ai/engine";
import { migrateExportBundle, SCHEMA_VERSION } from "@bookmark-ai/types";
import type { SessionTab } from "@bookmark-ai/types";

/**
 * The pure parts of the AI session summary feature (title + description):
 * which names count as machine-generated (and are therefore safe to replace),
 * the prompt's shape, the clamping of what the model returns, and the export
 * bundle's v3→v4 upgrade. The Gemini call itself is covered by the live
 * verification in docs/TESTING.md, not here — no network in unit tests.
 */

describe("isAutoSessionName — only a machine name may be overwritten", () => {
  it("recognizes saveSession's own default (client sent no name)", () => {
    // `${savedAt, locale-formatted} · N tabs`
    expect(isAutoSessionName("Aug 11, 3:42 PM · 8 tabs")).toBe(true);
    expect(isAutoSessionName("Dec 1, 12:05 AM · 1 tab")).toBe(true);
    // …and the branch where savedAt was unparseable.
    expect(isAutoSessionName("Session · 12 tabs")).toBe(true);
    expect(isAutoSessionName("session · 12 tabs")).toBe(true);
  });

  it("recognizes the mobile + web per-window Save default", () => {
    // apps/mobile SessionsScreen.saveWindow / apps/web ongoing-view promote.
    expect(isAutoSessionName("Tara's MacBook · Window 2")).toBe(true);
    expect(isAutoSessionName("Chrome device · Window 1")).toBe(true);
    expect(isAutoSessionName("Window · Window 11")).toBe(true);
  });

  it("treats an empty or whitespace name as auto (nothing to protect)", () => {
    expect(isAutoSessionName("")).toBe(true);
    expect(isAutoSessionName("   ")).toBe(true);
    expect(isAutoSessionName(null)).toBe(true);
    expect(isAutoSessionName(undefined)).toBe(true);
  });

  it("never claims a name the user typed", () => {
    expect(isAutoSessionName("Verilog research")).toBe(false);
    expect(isAutoSessionName("Taxes 2026")).toBe(false);
    // A user name that merely CONTAINS the default's shape is still theirs: the
    // patterns are anchored at both ends.
    expect(isAutoSessionName("Verilog · 4 tabs of docs")).toBe(false);
    expect(isAutoSessionName("Window 3 of the audit")).toBe(false);
    // An AI-generated multi-theme title must not read as auto either, or the
    // next save-path enrichment would feel free to clobber it.
    expect(isAutoSessionName("Verilog Research, Google Cloud Billing, YouTube")).toBe(false);
  });
});

const tab = (url: string, title: string): SessionTab => ({ url, title });

describe("buildSessionSummaryPrompt", () => {
  const tabs = [
    tab("https://en.wikipedia.org/wiki/Verilog", "Verilog - Wikipedia"),
    tab("https://console.cloud.google.com/billing", "Billing – Google Cloud"),
  ];

  it("asks for ONE object with both fields, and states the caps", () => {
    const prompt = buildSessionSummaryPrompt(tabs);
    expect(prompt).toContain("TITLE:");
    expect(prompt).toContain("DESCRIPTION:");
    expect(prompt).toContain(String(SESSION_NAME_MAX));
    expect(prompt).toContain("1-2 sentences");
    // Bans the "The user was…" opener QA caught the model defaulting to.
    expect(prompt).toContain('Never open with "The user"');
  });

  it("licenses comma-separated multi-theme titles instead of forcing one phrase", () => {
    const prompt = buildSessionSummaryPrompt(tabs);
    expect(prompt).toContain("comma-separated");
    expect(prompt).toMatch(/Do NOT force unrelated/);
  });

  it("lists each tab with its title and domain", () => {
    const prompt = buildSessionSummaryPrompt(tabs);
    expect(prompt).toContain("- Verilog - Wikipedia (en.wikipedia.org)");
    expect(prompt).toContain("- Billing – Google Cloud (console.cloud.google.com)");
    expect(prompt).toContain("Tabs (2 total, showing 2)");
  });

  it("caps the tab list at 40 but still reports the real total", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      tab(`https://example.com/${i}`, `Doc ${i}`),
    );
    const prompt = buildSessionSummaryPrompt(many);
    expect(prompt).toContain("Tabs (100 total, showing 40)");
    expect(prompt).toContain("- Doc 39 (example.com)");
    expect(prompt).not.toContain("- Doc 40 (example.com)");
  });

  it("passes a user-typed label as context only when given", () => {
    expect(buildSessionSummaryPrompt(tabs)).not.toContain("user's own label");
    const withLabel = buildSessionSummaryPrompt(tabs, "Chip design homework");
    expect(withLabel).toContain("Chip design homework");
    expect(withLabel).toContain("write the title from the tabs themselves");
  });
});

describe("parseSessionSummary", () => {
  it("trims, unquotes and keeps a good pair", () => {
    expect(parseSessionSummary({ name: '  "Verilog Research"  ', description: " Two docs. " })).toEqual(
      { name: "Verilog Research", description: "Two docs." },
    );
  });

  it("clamps an over-long title on a word boundary", () => {
    const long = `Verilog Research, Google Cloud Billing, YouTube Tutorials, ${"Extra Theme ".repeat(10)}`;
    const parsed = parseSessionSummary({ name: long, description: "x" });
    expect(parsed?.name.length).toBeLessThanOrEqual(SESSION_NAME_MAX);
    expect(parsed?.name.endsWith("…")).toBe(true);
    // Cut at a space, so no half-word survives (and no dangling comma).
    expect(parsed?.name).not.toMatch(/[,\s]…$/);
  });

  it("clamps an over-long description", () => {
    const parsed = parseSessionSummary({ name: "Ok", description: "word ".repeat(200) });
    expect(parsed?.description.length).toBeLessThanOrEqual(SESSION_DESCRIPTION_MAX);
  });

  it("drops a trailing partial sentence instead of cutting a word in half", () => {
    // Real shape observed in QA: the model overshot ~200 chars mid-clause.
    const description =
      "Researching Verilog and FPGA timing closure, including static timing analysis and fixing violations. " +
      "Also exploring Google Cloud for billing and deploying containers to Cloud Run, with some general browsing on Hacker News and other sites.";
    const parsed = parseSessionSummary({ name: "Ok", description });
    expect(parsed?.description).toBe(
      "Researching Verilog and FPGA timing closure, including static timing analysis and fixing violations.",
    );
    expect(parsed?.description.endsWith("…")).toBe(false);
  });

  it("still ellipsizes when no sentence end lands late enough", () => {
    const parsed = parseSessionSummary({
      name: "Ok",
      description: `Short. ${"a really long single sentence with no end in sight ".repeat(6)}`,
    });
    expect(parsed?.description.endsWith("…")).toBe(true);
    expect(parsed?.description.length).toBeLessThanOrEqual(SESSION_DESCRIPTION_MAX);
  });

  it("collapses newlines/whitespace the model may emit", () => {
    expect(parseSessionSummary({ name: "A\n B", description: "One.\n\nTwo." })).toEqual({
      name: "A B",
      description: "One. Two.",
    });
  });

  it("returns null when there is no usable title (caller then falls back)", () => {
    expect(parseSessionSummary({ name: "", description: "something" })).toBeNull();
    expect(parseSessionSummary({ description: "something" })).toBeNull();
    expect(parseSessionSummary(null)).toBeNull();
  });

  it("tolerates a missing description (title still applies)", () => {
    expect(parseSessionSummary({ name: "Verilog" })).toEqual({ name: "Verilog", description: "" });
  });
});

/** A v3 bundle: sessions have `os` but no `description`. */
function v3Bundle() {
  return {
    schemaVersion: 3,
    exportedAt: "2026-08-11T10:00:00.000Z",
    counts: { bookmarks: 0, sessions: 1, conversations: 0 },
    bookmarks: [],
    conversations: [],
    sessions: [
      {
        name: "Morning reading",
        tabs: [{ url: "https://a.test/", title: "A" }],
        tabCount: 1,
        browser: "chrome",
        device: "laptop",
        os: "macOS",
        savedAt: "2026-08-08T07:00:00.000Z",
        createdAt: "2026-08-08T07:00:01.000Z",
      },
    ],
  };
}

describe("export bundle v3 → v4 (session description)", () => {
  // v5 (skills) landed on top of v4 — see lib/server/export-bundle.test.ts for
  // the v4→v5 step; these assertions only care that the v3→v4 step still runs
  // inside the full chain.
  it("SCHEMA_VERSION is at least 5", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  });

  it("upgrades a v3 bundle losslessly, defaulting description to null", () => {
    const upgraded = migrateExportBundle(v3Bundle());
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION);
    const [session] = upgraded.sessions;
    expect(session.description).toBeNull();
    // Everything else survives verbatim.
    expect(session).toMatchObject({
      name: "Morning reading",
      tabCount: 1,
      browser: "chrome",
      device: "laptop",
      os: "macOS",
      savedAt: "2026-08-08T07:00:00.000Z",
      createdAt: "2026-08-08T07:00:01.000Z",
    });
    expect(session.tabs).toEqual([{ url: "https://a.test/", title: "A" }]);
  });

  it("round-trips a v4 bundle's description untouched", () => {
    const bundle = v3Bundle();
    const v4 = {
      ...bundle,
      schemaVersion: 4,
      sessions: [{ ...bundle.sessions[0], description: "Two AI papers and a billing console." }],
    };
    const out = migrateExportBundle(v4);
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.sessions[0].description).toBe("Two AI papers and a billing console.");
    // Re-running the upgrade on its own output is a no-op (idempotent).
    expect(migrateExportBundle(out)).toEqual(out);
  });

  it("still walks the whole chain from v1", () => {
    const v1 = { ...v3Bundle(), schemaVersion: 1, conversations: undefined };
    delete (v1 as Record<string, unknown>).conversations;
    const out = migrateExportBundle(v1);
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.conversations).toEqual([]);
    expect(out.sessions[0].description).toBeNull();
  });

  it("refuses a bundle newer than this build", () => {
    expect(() => migrateExportBundle({ ...v3Bundle(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(
      /newer than supported/,
    );
  });
});
