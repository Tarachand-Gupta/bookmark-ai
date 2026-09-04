import { describe, expect, it } from "vitest";
import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
  SKILL_MARKDOWN_TEMPLATE,
  importSkillSchema,
} from "@bookmark-ai/types";

const ok = (text: string) => {
  const r = parseSkillMarkdown(text);
  if ("error" in r) throw new Error(`expected a skill, got error: ${r.error}`);
  return r;
};
const err = (text: string) => {
  const r = parseSkillMarkdown(text);
  if (!("error" in r)) throw new Error(`expected an error, got skill ${r.name}`);
  return r.error;
};

describe("parseSkillMarkdown — frontmatter", () => {
  it("reads name/description from YAML frontmatter and the body as instructions", () => {
    const r = ok(`---\nname: Link triage\ndescription: Sort new links into keep / skim / drop\n---\n\nFor each link:\n- decide keep/skim/drop\n- one line why\n`);
    expect(r).toEqual({
      name: "Link triage",
      description: "Sort new links into keep / skim / drop",
      instructions: "For each link:\n- decide keep/skim/drop\n- one line why",
    });
  });

  it("ignores extra frontmatter keys, nested maps and comments", () => {
    const r = ok(`---\nname: pdf-processing\ndescription: "Extract text from PDFs"   # comment\nlicense: MIT\nallowed-tools: Bash(pdftotext:*)\nmetadata:\n  author: someone\n  version: 2\n---\nUse pdftotext.\n`);
    expect(r.name).toBe("pdf-processing");
    expect(r.description).toBe("Extract text from PDFs");
    expect(r.instructions).toBe("Use pdftotext.");
  });

  it("supports quoted values and folded/literal block scalars", () => {
    expect(ok(`---\nname: 'Research brief'\ndescription: "Build a \\"brief\\" from what I saved"\n---\nBody\n`).description).toBe('Build a "brief" from what I saved');
    const folded = ok(`---\nname: Research brief\ndescription: >-\n  Build a brief from\n  what I saved today\n---\nBody\n`);
    expect(folded.description).toBe("Build a brief from what I saved today");
    // A literal block is read line by line, then the description — a one-line
    // trigger — is flattened to a single line.
    const literal = ok(`---\nname: Research brief\ndescription: |\n  Line one\n  Line two\n---\nBody\n`);
    expect(literal.description).toBe("Line one Line two");
    // A quoted value keeps a `#` (it is not a comment inside quotes); a bare one drops it.
    expect(ok(`---\nname: X\ndescription: "keep # this"\n---\nBody\n`).description).toBe("keep # this");
    expect(ok(`---\nname: X\ndescription: drop this   # comment\n---\nBody\n`).description).toBe("drop this");
  });

  it("tolerates CRLF line endings, a BOM and leading blank lines", () => {
    const r = ok("﻿\r\n---\r\nname: Crlf skill\r\ndescription: Windows file\r\n---\r\n\r\nStep 1\r\nStep 2\r\n");
    expect(r).toEqual({ name: "Crlf skill", description: "Windows file", instructions: "Step 1\nStep 2" });
  });

  it("reports a missing name / description / body readably", () => {
    expect(err(`---\ndescription: d\n---\nBody`)).toMatch(/needs a `name:`/);
    expect(err(`---\nname: X\n---\nBody`)).toMatch(/needs a `description:`/);
    expect(err(`---\nname: X\ndescription: d\n---\n\n`)).toMatch(/no instructions/);
  });

  it("enforces the name/instructions limits with the schema's messages", () => {
    expect(err(`---\nname: ${"x".repeat(61)}\ndescription: d\n---\nBody`)).toMatch(/60 characters or fewer/);
    expect(err(`---\nname: bad/name\ndescription: d\n---\nBody`)).toMatch(/letters, digits, spaces, hyphens and underscores/);
    expect(err(`---\nname: X\ndescription: d\n---\n${"b".repeat(32_001)}`)).toMatch(/32000 characters or fewer/);
  });

  it("shortens an over-long description (agentskills allows 1,024) to the 200-char trigger, with a warning", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "); // ~400 chars
    const r = ok(`---\nname: Long desc\ndescription: ${words}\n---\nBody`);
    expect(r.description.length).toBeLessThanOrEqual(200);
    expect(r.description.length).toBeGreaterThan(150);
    expect(r.description.endsWith("…")).toBe(true);
    // Cut at a word boundary: the last token before the ellipsis is a whole word.
    const lastWord = r.description.slice(0, -1).split(" ").pop();
    expect(words.split(" ")).toContain(lastWord);
    expect(r.warnings).toEqual([expect.stringMatching(/shortened from \d+ to 200 characters/)]);
    // Exactly at the limit → untouched, no warning.
    const exact = ok(`---\nname: Exact\ndescription: ${"d".repeat(200)}\n---\nBody`);
    expect(exact.description).toBe("d".repeat(200));
    expect(exact.warnings).toBeUndefined();
  });
});

describe("parseSkillMarkdown — heading fallback", () => {
  it("uses the first heading as name, the first paragraph as description, the rest as instructions", () => {
    const r = ok(`Some preamble\n\n# Weekly digest\n\nSummarise what I saved this week,\ngrouped by theme.\n\n1. List\n2. Group\n`);
    expect(r).toEqual({
      name: "Weekly digest",
      description: "Summarise what I saved this week, grouped by theme.",
      instructions: "1. List\n2. Group",
    });
  });

  it("explains what is missing", () => {
    expect(err("just some text without a heading")).toMatch(/frontmatter .* or start with a `# Heading`/);
    expect(err("# Title only\n")).toMatch(/one-line description under the heading/);
    expect(err("# Title\n\nDescription paragraph only\n")).toMatch(/no instructions/);
    expect(err("   \n")).toMatch(/empty/);
  });
});

describe("serializeSkillMarkdown / template", () => {
  it("round-trips any name/description/instructions through the parser", () => {
    const skill = {
      name: "Quote_it-2",
      description: 'Handles "quotes", colons: and # hashes\nacross lines',
      instructions: "Line 1\n\n- bullet\r\n- another",
    };
    const md = serializeSkillMarkdown(skill);
    expect(md.startsWith("---\nname: ")).toBe(true);
    const back = ok(md);
    expect(back.name).toBe(skill.name);
    expect(back.description).toBe('Handles "quotes", colons: and # hashes across lines');
    expect(back.instructions).toBe("Line 1\n\n- bullet\n- another");
  });

  it("the starter template parses", () => {
    const r = ok(SKILL_MARKDOWN_TEMPLATE);
    expect(r.name).toBe("Weekly reading digest");
    expect(r.instructions).toContain("Group them into 3-6 themes");
  });

  it("the import body schema caps the document size", () => {
    expect(importSkillSchema.safeParse({ markdown: "" }).success).toBe(false);
    expect(importSkillSchema.safeParse({ markdown: "x".repeat(64 * 1024 + 1) }).success).toBe(false);
    expect(importSkillSchema.parse({ markdown: "# x", enabled: false })).toEqual({ markdown: "# x", enabled: false });
  });
});
