import { describe, expect, it } from "vitest";
import { SKILL_DESCRIPTION_MAX, SKILL_INSTRUCTIONS_MAX, SKILL_MARKDOWN_MAX, SKILL_NAME_MAX } from "@bookmark-ai/types";
import {
  SKILL_IMPORT_COPY,
  draftFromMarkdown,
  isSkillFileName,
  parseSkillMarkdown,
  skillFileError,
} from "./skill-markdown";

const SKILL_MD = `---
name: Changelog writer
description: Turn a list of merged PRs or commits into a user-facing changelog.
---

# Changelog writer

When I paste PR titles or commit messages:

1. Group by Added / Changed / Fixed.
2. Rewrite each in the user's language.
`;

describe("parseSkillMarkdown (shared parser, as the importer uses it)", () => {
  it("reads frontmatter name/description and the body as instructions", () => {
    expect(parseSkillMarkdown(SKILL_MD)).toEqual({
      name: "Changelog writer",
      description: "Turn a list of merged PRs or commits into a user-facing changelog.",
      instructions:
        "# Changelog writer\n\nWhen I paste PR titles or commit messages:\n\n1. Group by Added / Changed / Fixed.\n2. Rewrite each in the user's language.",
    });
  });

  it("accepts quoted values, CRLF, a BOM and extra keys", () => {
    const text = `﻿---\r\nname: "PDF triage"\r\nlicense: MIT\r\ndescription: 'Sort PDFs.'\r\n---\r\nDo the thing.\r\n`;
    expect(parseSkillMarkdown(text)).toEqual({
      name: "PDF triage",
      description: "Sort PDFs.",
      instructions: "Do the thing.",
    });
  });

  it("folds > block scalars", () => {
    const folded = `---\nname: Folded\ndescription: >\n  Line one\n  line two.\n---\nBody`;
    expect(parseSkillMarkdown(folded)).toMatchObject({ description: "Line one line two." });
  });

  it("falls back to heading → first paragraph → the rest", () => {
    const text = `Some preamble\n\n# Link triage\n\nSort my recent saves into keep / read later / drop,\none line each.\n\n1. Fetch the last 20.\n2. Bucket them.\n`;
    expect(parseSkillMarkdown(text)).toEqual({
      name: "Link triage",
      description: "Sort my recent saves into keep / read later / drop, one line each.",
      instructions: "1. Fetch the last 20.\n2. Bucket them.",
    });
  });

  it("returns a readable error for every missing piece", () => {
    expect(parseSkillMarkdown("")).toEqual({ error: "The skill file is empty" });
    expect(parseSkillMarkdown(`---\ndescription: x\n---\nBody`)).toMatchObject({
      error: expect.stringContaining("`name:`"),
    });
    expect(parseSkillMarkdown(`---\nname: x\n---\nBody`)).toMatchObject({
      error: expect.stringContaining("`description:`"),
    });
    expect(parseSkillMarkdown(`---\nname: x\ndescription: y\n---\n\n`)).toMatchObject({
      error: expect.stringContaining("no instructions"),
    });
    expect(parseSkillMarkdown("just text")).toMatchObject({ error: expect.stringContaining("Couldn't find a skill") });
    expect(parseSkillMarkdown("# Name only\n\n")).toMatchObject({ error: expect.stringContaining("description") });
  });

  it("applies the shared limits and name pattern", () => {
    const long = (n: number) => "x".repeat(n);
    expect(parseSkillMarkdown(`---\nname: ${long(SKILL_NAME_MAX + 1)}\ndescription: d\n---\nBody`)).toMatchObject({
      error: expect.stringMatching(/Name must be/),
    });
    // An over-long description is shortened to fit, with a warning — not fatal.
    const shortened = parseSkillMarkdown(
      `---\nname: n\ndescription: ${long(SKILL_DESCRIPTION_MAX + 1)}\n---\nBody`,
    );
    expect(shortened).toMatchObject({ name: "n", warnings: [expect.stringMatching(/shortened/i)] });
    expect("error" in shortened).toBe(false);
    if (!("error" in shortened)) expect(shortened.description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX);
    expect(
      parseSkillMarkdown(`---\nname: n\ndescription: d\n---\n${long(SKILL_INSTRUCTIONS_MAX + 1)}`),
    ).toMatchObject({ error: expect.stringMatching(/Instructions must be/) });
    expect(parseSkillMarkdown(`---\nname: "Digest: weekly!"\ndescription: d\n---\nBody`)).toMatchObject({
      error: expect.stringMatching(/letters, digits/),
    });
    expect(parseSkillMarkdown(`---\nname: ${long(SKILL_NAME_MAX)}\ndescription: d\n---\nBody`)).not.toHaveProperty(
      "error",
    );
  });
});

describe("draftFromMarkdown", () => {
  it("prefills an enabled draft or passes the error through", () => {
    expect(draftFromMarkdown(SKILL_MD)).toEqual({
      draft: {
        name: "Changelog writer",
        description: "Turn a list of merged PRs or commits into a user-facing changelog.",
        instructions: expect.stringContaining("Group by Added"),
        enabled: true,
      },
    });
    expect(draftFromMarkdown("nothing here")).toHaveProperty("error");
  });

  it("carries the parser's warnings alongside the draft, and omits the key when there are none", () => {
    const clean = draftFromMarkdown(SKILL_MD);
    expect(clean).not.toHaveProperty("warnings");
    const shortened = draftFromMarkdown(`---\nname: n\ndescription: ${"y ".repeat(150)}\n---\nBody`);
    expect(shortened).toMatchObject({ warnings: [expect.stringMatching(/shortened/i)] });
    if ("draft" in shortened) expect(shortened.draft.description.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX);
  });
});

describe("file gates", () => {
  it("isSkillFileName matches by extension, case-insensitively", () => {
    expect(isSkillFileName("SKILL.md")).toBe(true);
    expect(isSkillFileName("notes.TXT")).toBe(true);
    expect(isSkillFileName("skill.markdown")).toBe(true);
    expect(isSkillFileName("skill.pdf")).toBe(false);
    expect(isSkillFileName("md")).toBe(false);
  });

  it("skillFileError rejects the wrong type first, then oversize", () => {
    expect(skillFileError({ name: "skill.pdf", size: 10 })).toBe(SKILL_IMPORT_COPY.wrongType);
    expect(skillFileError({ name: "SKILL.md", size: SKILL_MARKDOWN_MAX + 1 })).toBe(SKILL_IMPORT_COPY.tooLarge);
    expect(skillFileError({ name: "SKILL.md", size: SKILL_MARKDOWN_MAX })).toBeNull();
    expect(SKILL_IMPORT_COPY.tooLarge).toContain("64 KB");
  });
});
