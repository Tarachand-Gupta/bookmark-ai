import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assistantBlocks,
  formatToolInput,
  hostOf,
  summarizeToolOutput,
  thoughtLabel,
  toolName,
  toolPhase,
  toolRowCopy,
  userContent,
  type LoosePart,
} from "./chatParts";

describe("userContent", () => {
  it("joins text parts and lifts file parts", () => {
    const parts: LoosePart[] = [
      { type: "file", mediaType: "image/jpeg", filename: "a.jpg", url: "data:image/jpeg;base64,QQ==" },
      { type: "text", text: "What is " },
      { type: "step-start" },
      { type: "text", text: "this?  " },
      { type: "file", mediaType: "text/markdown", url: "data:text/markdown;base64,QQ==" },
    ];
    assert.deepEqual(userContent(parts), {
      text: "What is this?",
      files: [
        { mediaType: "image/jpeg", filename: "a.jpg", url: "data:image/jpeg;base64,QQ==" },
        { mediaType: "text/markdown", filename: undefined, url: "data:text/markdown;base64,QQ==" },
      ],
    });
  });
  it("ignores a file part without a url", () => {
    assert.equal(userContent([{ type: "file", mediaType: "image/png" }]).files.length, 0);
  });
});

describe("assistantBlocks", () => {
  it("merges adjacent reasoning, keeps tools between them apart, drops the rest", () => {
    const parts: LoosePart[] = [
      { type: "step-start" },
      { type: "reasoning", text: "First thought.", state: "done" },
      { type: "reasoning", text: "Second thought.", state: "streaming" },
      { type: "tool-searchBookmarks", toolCallId: "call_1", state: "output-available", input: {}, output: {} },
      { type: "reasoning", text: "Third." },
      { type: "source-url", url: "https://x" },
      { type: "text", text: "   " },
      { type: "text", text: "Answer." },
      { type: "data-whatever" },
      { type: "file", mediaType: "image/png", url: "data:," },
    ];
    const blocks = assistantBlocks("m1", parts);
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["reasoning", "tool", "reasoning", "text"],
    );
    const first = blocks[0];
    assert.equal(first.kind, "reasoning");
    if (first.kind === "reasoning") {
      assert.equal(first.text, "First thought.\n\nSecond thought.");
      assert.equal(first.streaming, true);
      assert.equal(first.key, "m1-r1");
    }
    const tool = blocks[1];
    assert.equal(tool.kind === "tool" && tool.key, "call_1");
    const third = blocks[2];
    assert.equal(third.kind === "reasoning" && third.streaming, false);
    const text = blocks[3];
    assert.equal(text.kind === "text" && text.text, "Answer.");
  });

  it("keeps an empty streaming thought (it will fill) but drops an empty finished one", () => {
    assert.equal(assistantBlocks("m", [{ type: "reasoning", text: "", state: "streaming" }]).length, 1);
    assert.equal(assistantBlocks("m", [{ type: "reasoning", text: "", state: "done" }]).length, 0);
  });

  it("renders nothing for an unknown message shape rather than throwing", () => {
    assert.deepEqual(assistantBlocks("m", [{ type: "something-new" }, { type: "step-start" }]), []);
  });
});

describe("toolPhase", () => {
  it("collapses the SDK lifecycle to four states", () => {
    assert.equal(toolPhase("input-streaming"), "input-streaming");
    assert.equal(toolPhase("input-available"), "input-available");
    assert.equal(toolPhase("approval-requested"), "input-available");
    assert.equal(toolPhase(undefined), "input-available");
    assert.equal(toolPhase("output-available"), "output-available");
    assert.equal(toolPhase("output-error"), "output-error");
  });
});

describe("toolName", () => {
  it("reads static and dynamic tool names", () => {
    assert.equal(toolName({ type: "tool-searchBookmarks" }), "searchBookmarks");
    assert.equal(toolName({ type: "dynamic-tool", toolName: "mcp_thing" }), "mcp_thing");
    assert.equal(toolName({ type: "dynamic-tool" }), "tool");
  });
});

describe("toolRowCopy", () => {
  it("searchBookmarks: query while running, count when done", () => {
    assert.equal(
      toolRowCopy({ type: "tool-searchBookmarks", state: "input-available", input: { query: "rust async" } }).label,
      "Searching bookmarks for “rust async”",
    );
    assert.equal(
      toolRowCopy({ type: "tool-searchBookmarks", state: "input-streaming" }).label,
      "Searching bookmarks",
    );
    const done = (n: number) =>
      toolRowCopy({
        type: "tool-searchBookmarks",
        state: "output-available",
        input: { query: "x" },
        output: { results: Array.from({ length: n }, (_, i) => ({ title: `t${i}` })) },
      }).label;
    assert.equal(done(3), "Found 3 bookmarks");
    assert.equal(done(1), "Found 1 bookmark");
    assert.equal(done(0), "No bookmarks found");
  });

  it("queryDatabase rows, with a + when the runner truncated", () => {
    assert.equal(
      toolRowCopy({ type: "tool-queryDatabase", state: "output-available", output: { rowCount: 12, rows: [] } }).label,
      "12 rows",
    );
    assert.equal(
      toolRowCopy({ type: "tool-queryDatabase", state: "output-available", output: { rowCount: 1, rows: [[1]] } }).label,
      "1 row",
    );
    assert.equal(
      toolRowCopy({
        type: "tool-queryDatabase",
        state: "output-available",
        output: { rowCount: 200, rows: [], truncated: true },
      }).label,
      "200+ rows",
    );
    assert.equal(toolRowCopy({ type: "tool-queryDatabase", state: "input-available" }).label, "Querying your library");
  });

  it("listSessions and listLiveTabs", () => {
    assert.equal(
      toolRowCopy({ type: "tool-listSessions", state: "output-available", output: { total: 4, sessions: [] } }).label,
      "4 sessions",
    );
    assert.equal(
      toolRowCopy({ type: "tool-listLiveTabs", state: "output-available", output: { enabled: false, devices: [] } }).label,
      "Live sharing is off",
    );
    assert.equal(
      toolRowCopy({
        type: "tool-listLiveTabs",
        state: "output-available",
        output: { enabled: true, devices: [{ tabCount: 3 }, { tabCount: 4 }] },
      }).label,
      "7 tabs on 2 devices",
    );
    assert.equal(toolRowCopy({ type: "tool-listLiveTabs", state: "input-available", input: {} }).label, "Checking live tabs");
  });

  it("webSearch, fetchUrl, useSkill", () => {
    assert.equal(
      toolRowCopy({ type: "tool-webSearch", state: "input-available", input: { query: "expo 57" } }).label,
      "Searching the web for “expo 57”",
    );
    assert.equal(
      toolRowCopy({ type: "tool-webSearch", state: "output-available", output: { results: [{}, {}, {}, {}] } }).label,
      "4 sources",
    );
    assert.equal(
      toolRowCopy({ type: "tool-fetchUrl", state: "input-available", input: { url: "https://www.example.com/a" } }).label,
      "Reading example.com",
    );
    assert.equal(
      toolRowCopy({
        type: "tool-fetchUrl",
        state: "output-available",
        input: { url: "https://example.com" },
        output: { title: "Example Domain", text: "…" },
      }).label,
      "Read Example Domain",
    );
    assert.equal(
      toolRowCopy({ type: "tool-useSkill", state: "input-available", input: { name: "Research brief" } }).label,
      "Loading skill “Research brief”",
    );
    assert.equal(
      toolRowCopy({ type: "tool-useSkill", state: "output-available", output: { name: "Research brief", instructions: "…" } })
        .label,
      "Using skill “Research brief”",
    );
  });

  it("output-error and an {error} output are the SAME failed state, with the error text", () => {
    const hard = toolRowCopy({ type: "tool-fetchUrl", state: "output-error", input: { url: "https://a.b" }, errorText: "boom" });
    assert.equal(hard.label, "Couldn't read a.b");
    assert.equal(hard.failed, true);
    assert.equal(hard.error, "boom");
    // output-error without errorText still has something to show
    assert.equal(toolRowCopy({ type: "tool-webSearch", state: "output-error" }).error, "The tool failed.");
    const soft = toolRowCopy({
      type: "tool-queryDatabase",
      state: "output-available",
      output: { error: "no such column: foo" },
    });
    assert.equal(soft.label, "Query failed");
    assert.equal(soft.failed, true);
    assert.equal(soft.error, "no such column: foo");
    // the shape the server actually sends for a blocked fetch
    const blocked = toolRowCopy({
      type: "tool-fetchUrl",
      state: "output-available",
      input: { url: "http://10.255.255.1/x" },
      output: { error: "blocked address 10.255.255.1" },
    });
    assert.equal(blocked.label, "Couldn't read 10.255.255.1");
    assert.equal(blocked.failed, true);
    assert.equal(blocked.error, "blocked address 10.255.255.1");
    const skill = toolRowCopy({ type: "tool-useSkill", state: "output-available", input: { name: "Nope" }, output: { error: "not found" } });
    assert.equal(skill.label, "Skill “Nope” not found");
    assert.equal(skill.failed, true);
    assert.equal(skill.error, "not found");
    // a successful output is not failed
    const ok = toolRowCopy({ type: "tool-useSkill", state: "output-available", output: { name: "X", instructions: "…" } });
    assert.equal(ok.failed, false);
    assert.equal(ok.error, null);
  });

  it("createSkill / installSkill narrate the step and fail on {error}", () => {
    assert.equal(
      toolRowCopy({ type: "tool-createSkill", state: "input-available", input: { name: "Link triage" } }).label,
      "Creating skill “Link triage”",
    );
    const created = toolRowCopy({
      type: "tool-createSkill",
      state: "output-available",
      input: { name: "Link triage" },
      output: { name: "Link triage", description: "Sorts new saves into read-now / later." },
    });
    assert.equal(created.label, "Created skill “Link triage”");
    assert.equal(created.failed, false);
    assert.equal(
      summarizeToolOutput("createSkill", { name: "Link triage", description: "Sorts new saves into read-now / later." }),
      "Link triage\nSorts new saves into read-now / later.",
    );
    const createFailed = toolRowCopy({
      type: "tool-createSkill",
      state: "output-available",
      input: { name: "Link triage" },
      output: { error: "a skill with that name exists" },
    });
    assert.equal(createFailed.label, "Couldn't create skill “Link triage”");
    assert.equal(createFailed.failed, true);
    assert.equal(createFailed.error, "a skill with that name exists");

    assert.equal(
      toolRowCopy({ type: "tool-installSkill", state: "input-available", input: { url: "https://skills.example.com/x/SKILL.md" } }).label,
      "Installing skill from skills.example.com",
    );
    const installed = toolRowCopy({
      type: "tool-installSkill",
      state: "output-available",
      input: { url: "https://skills.example.com/x/SKILL.md" },
      output: { name: "Weekly digest", description: "Summarises the week." },
    });
    assert.equal(installed.label, "Installed skill “Weekly digest”");
    assert.equal(summarizeToolOutput("installSkill", { name: "Weekly digest", description: "Summarises the week." }), "Weekly digest\nSummarises the week.");
    const installFailed = toolRowCopy({
      type: "tool-installSkill",
      state: "output-available",
      input: { url: "https://skills.example.com/x/SKILL.md" },
      output: { error: "blocked address 10.255.255.1" },
    });
    assert.equal(installFailed.label, "Couldn't install skill from skills.example.com");
    assert.equal(installFailed.failed, true);
    assert.equal(installFailed.error, "blocked address 10.255.255.1");
  });

  it("an unknown tool never renders blank", () => {
    assert.equal(toolRowCopy({ type: "dynamic-tool", toolName: "fooBar", state: "input-available" }).label, "Running foo bar");
    assert.equal(toolRowCopy({ type: "tool-fooBar", state: "output-available", output: {} }).label, "Foo bar finished");
  });
});

describe("thoughtLabel", () => {
  it("streams, times, or stays generic for persisted parts", () => {
    assert.equal(thoughtLabel(true, null), "Thinking");
    assert.equal(thoughtLabel(false, 0.2), "Thought for 1 s");
    assert.equal(thoughtLabel(false, 7.6), "Thought for 8 s");
    assert.equal(thoughtLabel(false, 125), "Thought for 2 min");
    assert.equal(thoughtLabel(false, null), "Thoughts");
  });
});

describe("summaries", () => {
  it("formatToolInput hides empty args", () => {
    assert.equal(formatToolInput({}), null);
    assert.equal(formatToolInput(undefined), null);
    assert.equal(formatToolInput({ query: "x" }), '{\n  "query": "x"\n}');
  });
  it("summarizeToolOutput per tool", () => {
    assert.equal(
      summarizeToolOutput("queryDatabase", { columns: ["category", "n"], rows: [["dev", 12], [null, 1]] }),
      "category | n\ndev | 12\n∅ | 1",
    );
    assert.equal(
      summarizeToolOutput("searchBookmarks", {
        results: Array.from({ length: 8 }, (_, i) => ({ title: `Title ${i}`, category: "Dev" })),
      }),
      [...Array.from({ length: 6 }, (_, i) => `• Title ${i} · Dev`), "… and 2 more"].join("\n"),
    );
    assert.equal(summarizeToolOutput("listLiveTabs", { enabled: false }), "Live tab sharing is off for this account.");
    assert.equal(summarizeToolOutput("anything", { error: "nope" }), "nope");
    assert.equal(summarizeToolOutput("fetchUrl", { title: "T", text: "body" }), "T\nbody");
    assert.equal(summarizeToolOutput("webSearch", { results: [] }), "Nothing found");
  });
  it("hostOf", () => {
    assert.equal(hostOf("https://www.example.com/path?q=1"), "example.com");
    assert.equal(hostOf("not a url"), "not a url");
  });
});
