import { describe, expect, it } from "vitest";
import {
  compactJson,
  describeToolPart,
  hostOf,
  humanizeToolName,
  reasoningSeconds,
  skillsCreatedIn,
  toolNoun,
} from "./chat-tools";

describe("describeToolPart — searchBookmarks", () => {
  it("runs, then counts, with the query as detail", () => {
    const running = describeToolPart("searchBookmarks", "input-available", { query: "databases" }, undefined);
    expect(running).toMatchObject({ phase: "running", label: "Searching bookmarks for “databases”", icon: "search" });

    const done = describeToolPart(
      "searchBookmarks",
      "output-available",
      { query: "databases", mode: "hybrid" },
      { mode: "hybrid", fallback: false, results: [{}, {}, {}] },
    );
    expect(done).toMatchObject({ phase: "done", label: "Found 3 bookmarks", detail: "“databases”" });

    const one = describeToolPart("searchBookmarks", "output-available", { query: "x" }, { results: [{}] });
    expect(one.label).toBe("Found 1 bookmark");
  });

  it("flags semantic mode and text fallback", () => {
    expect(describeToolPart("searchBookmarks", "input-streaming", { mode: "semantic" }, undefined).icon).toBe("semantic");
    expect(
      describeToolPart("searchBookmarks", "output-available", {}, { mode: "text", fallback: true, results: [] }).label,
    ).toBe("Found 0 bookmarks · text fallback");
  });

  it("treats output-error and {error} outputs as failures", () => {
    expect(describeToolPart("searchBookmarks", "output-error", { query: "q" }, undefined, "boom")).toMatchObject({
      phase: "error",
      label: "Bookmark search failed",
      errorText: "boom",
    });
    expect(describeToolPart("searchBookmarks", "output-available", {}, { error: "index offline" })).toMatchObject({
      phase: "error",
      errorText: "index offline",
    });
  });
});

describe("describeToolPart — queryDatabase", () => {
  it("counts rows from rowCount or rows, marks capped results", () => {
    expect(describeToolPart("queryDatabase", "input-available", { purpose: "per category" }, undefined)).toMatchObject({
      phase: "running",
      label: "Querying your library",
      detail: "per category",
    });
    expect(describeToolPart("queryDatabase", "output-available", {}, { rowCount: 12, rows: [] }).label).toBe("12 rows");
    expect(describeToolPart("queryDatabase", "output-available", {}, { rows: [[1]] }).label).toBe("1 row");
    expect(describeToolPart("queryDatabase", "output-available", {}, { rowCount: 200, truncated: true }).label).toBe(
      "200 rows · capped",
    );
    expect(describeToolPart("queryDatabase", "output-available", {}, { error: "no such table" })).toMatchObject({
      phase: "error",
      errorText: "no such table",
    });
  });
});

describe("describeToolPart — listSessions / listLiveTabs", () => {
  it("counts sessions", () => {
    expect(describeToolPart("listSessions", "input-available", {}, undefined).label).toBe("Listing saved sessions");
    expect(describeToolPart("listSessions", "output-available", {}, { total: 5, sessions: [{}, {}] }).label).toBe(
      "2 sessions",
    );
  });

  it("reports live tabs across devices, sharing off, and unavailable", () => {
    expect(describeToolPart("listLiveTabs", "input-streaming", {}, undefined).label).toBe("Checking live tabs");
    const done = describeToolPart(
      "listLiveTabs",
      "output-available",
      {},
      {
        enabled: true,
        devices: [
          { tabCount: 3, windows: [{ tabs: [{}, {}, {}] }] },
          { windows: [{ tabs: [{}] }, { tabs: [{}, {}] }] },
        ],
      },
    );
    expect(done).toMatchObject({ phase: "done", label: "6 tabs on 2 devices" });
    expect(describeToolPart("listLiveTabs", "output-available", {}, { enabled: false, devices: [] })).toMatchObject({
      phase: "done",
      label: "Live sharing is off",
    });
    expect(describeToolPart("listLiveTabs", "output-available", {}, { error: "live tabs unavailable" })).toMatchObject({
      phase: "error",
      label: "Live tabs unavailable",
      errorText: "live tabs unavailable",
    });
  });
});

/**
 * The server never emits `tool-output-error`: every tool failure is
 * `state: "output-available"` with `{ error: "…" }` in the output. That MUST
 * read as the error state for every tool — never a green check — while the
 * SDK's own `output-error` + `errorText` stays handled for provider failures.
 */
describe("describeToolPart — visual state", () => {
  const tools = [
    "searchBookmarks",
    "queryDatabase",
    "listSessions",
    "listLiveTabs",
    "webSearch",
    "fetchUrl",
    "useSkill",
    "someDynamicTool",
  ];

  it("output-available + {error} is the error phase with the text verbatim, for every tool", () => {
    for (const tool of tools) {
      const view = describeToolPart(tool, "output-available", { query: "q", name: "x", url: "https://x.io" }, {
        error: "blocked address 10.255.255.1",
      });
      expect(view.phase, tool).toBe("error");
      expect(view.errorText, tool).toBe("blocked address 10.255.255.1");
    }
    expect(describeToolPart("useSkill", "output-available", { name: "x" }, { error: 'Skill "x" is disabled' })).toMatchObject({
      phase: "error",
      label: "Skill “x” unavailable",
      errorText: 'Skill "x" is disabled',
    });
  });

  it("output-error / output-denied with errorText is the error phase too", () => {
    for (const tool of tools) {
      expect(describeToolPart(tool, "output-error", {}, undefined, "provider exploded"), tool).toMatchObject({
        phase: "error",
        errorText: "provider exploded",
      });
      expect(describeToolPart(tool, "output-denied", {}, undefined).phase, tool).toBe("error");
    }
  });

  it("input states are running; a non-error output is done", () => {
    for (const tool of tools) {
      expect(describeToolPart(tool, "input-streaming", undefined, undefined).phase, tool).toBe("running");
      expect(describeToolPart(tool, "input-available", {}, undefined).phase, tool).toBe("running");
      expect(describeToolPart(tool, "output-available", {}, { ok: true, results: [], rows: [] }).phase, tool).toBe("done");
    }
    // An `error` key that isn't a string is not a failure signal.
    expect(describeToolPart("fetchUrl", "output-available", {}, { error: null, title: "T" }).phase).toBe("done");
  });
});

describe("describeToolPart — webSearch / fetchUrl / useSkill", () => {
  it("web search copy", () => {
    expect(describeToolPart("webSearch", "input-available", { query: "sqlite fts5" }, undefined).label).toBe(
      "Searching the web for “sqlite fts5”",
    );
    expect(describeToolPart("webSearch", "output-available", { query: "x" }, { results: [{}, {}, {}, {}] }).label).toBe(
      "4 sources",
    );
  });

  it("fetchUrl reads a host, then names the title", () => {
    expect(
      describeToolPart("fetchUrl", "input-available", { url: "https://www.example.com/a/b" }, undefined).label,
    ).toBe("Reading example.com");
    expect(
      describeToolPart(
        "fetchUrl",
        "output-available",
        { url: "https://example.com/a" },
        { url: "https://example.com/a", title: "Example Domain" },
      ),
    ).toMatchObject({ phase: "done", label: "Read Example Domain", detail: "example.com" });
    expect(describeToolPart("fetchUrl", "output-available", { url: "https://x.io" }, { error: "blocked" })).toMatchObject({
      phase: "error",
      label: "Couldn't read x.io",
      errorText: "blocked",
    });
  });

  it("useSkill loads then applies, and reports an unknown skill", () => {
    expect(describeToolPart("useSkill", "input-available", { name: "Link triage" }, undefined)).toMatchObject({
      phase: "running",
      label: "Loading skill “Link triage”",
      icon: "skill",
    });
    expect(
      describeToolPart("useSkill", "output-available", { name: "link triage" }, { name: "Link triage", instructions: "…" })
        .label,
    ).toBe("Using skill “Link triage”");
    expect(describeToolPart("useSkill", "output-available", { name: "Nope" }, { error: "No skill named Nope" })).toMatchObject({
      phase: "error",
      label: "Skill “Nope” unavailable",
      errorText: "No skill named Nope",
    });
  });
});

describe("describeToolPart — createSkill / installSkill (CONTRACT §3b)", () => {
  it("createSkill: creating → created, names from the output first", () => {
    expect(describeToolPart("createSkill", "input-available", { name: "Changelog writer" }, undefined)).toMatchObject({
      phase: "running",
      icon: "skill",
      label: "Creating skill “Changelog writer”",
    });
    expect(
      describeToolPart(
        "createSkill",
        "output-available",
        { name: "changelog writer" },
        { skill: { id: "s1", name: "Changelog writer", description: "d" } },
      ),
    ).toMatchObject({ phase: "done", label: "Created skill “Changelog writer”" });
    expect(
      describeToolPart("createSkill", "output-available", { name: "Dup" }, { error: "A skill with this name already exists — try “Dup 2”" }),
    ).toMatchObject({ phase: "error", label: "Couldn't create skill “Dup”", errorText: expect.stringContaining("already exists") });
  });

  it("installSkill: from host → installed “name”", () => {
    expect(
      describeToolPart("installSkill", "input-available", { url: "https://github.com/x/y/blob/main/SKILL.md" }, undefined),
    ).toMatchObject({ phase: "running", label: "Installing skill from github.com" });
    expect(
      describeToolPart(
        "installSkill",
        "output-available",
        { url: "https://github.com/x/y/SKILL.md" },
        { skill: { id: "s2", name: "PDF triage", description: "d" } },
      ),
    ).toMatchObject({ phase: "done", label: "Installed skill “PDF triage”", detail: "github.com" });
    expect(
      describeToolPart("installSkill", "output-available", { url: "http://10.0.0.1/x.md" }, { error: "blocked address 10.0.0.1" }),
    ).toMatchObject({ phase: "error", label: "Couldn't install skill from 10.0.0.1", errorText: "blocked address 10.0.0.1" });
  });

  it("skillsCreatedIn counts settled skill-writing parts with a skill", () => {
    expect(
      skillsCreatedIn([
        { type: "text" },
        { type: "tool-createSkill", state: "output-available", output: { skill: { id: "a", name: "A" } } },
        { type: "tool-createSkill", state: "output-available", output: { error: "nope" } },
        { type: "tool-installSkill", state: "input-available" },
        { type: "dynamic-tool", toolName: "installSkill", state: "output-available", output: { skill: { id: "b" } } },
        { type: "tool-useSkill", state: "output-available", output: { name: "A", instructions: "…" } },
      ]),
    ).toBe(2);
    expect(skillsCreatedIn([])).toBe(0);
  });
});

describe("describeToolPart — unknown / dynamic tools", () => {
  it("never crashes and humanizes the name", () => {
    expect(describeToolPart("summarizeThread", "input-streaming", undefined, undefined)).toMatchObject({
      phase: "running",
      label: "Running summarize thread",
      icon: "generic",
    });
    expect(describeToolPart("summarize_thread", "output-available", null, "ok").label).toBe("Ran summarize thread");
    expect(describeToolPart("x", "output-error", 1, 2, "nope")).toMatchObject({ phase: "error", errorText: "nope" });
    expect(describeToolPart("", "output-available", [], []).label).toBe("Ran tool");
  });
});

describe("helpers", () => {
  it("humanizeToolName / toolNoun / hostOf", () => {
    expect(humanizeToolName("listLiveTabs")).toBe("list live tabs");
    expect(humanizeToolName("web_search-v2")).toBe("web search v2");
    expect(toolNoun("searchBookmarks")).toBe("Bookmark search");
    expect(toolNoun("doThing")).toBe("Do thing");
    expect(hostOf("https://www.example.com/x")).toBe("example.com");
    expect(hostOf("not a url")).toBe("not a url");
  });

  it("compactJson truncates and tolerates anything", () => {
    expect(compactJson(undefined)).toBe("");
    expect(compactJson("plain")).toBe("plain");
    expect(compactJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(compactJson("x".repeat(20), 5)).toBe("xxxxx…");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(compactJson(circular)).toBe("[object Object]");
  });

  it("reasoningSeconds rounds and floors at 1", () => {
    expect(reasoningSeconds(0, 200)).toBe(1);
    expect(reasoningSeconds(0, 2600)).toBe(3);
    expect(reasoningSeconds(10, 5)).toBe(1);
  });
});
