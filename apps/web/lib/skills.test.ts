import { describe, expect, it } from "vitest";
import {
  EMPTY_SKILL_DRAFT,
  SKILL_LIMITS,
  SKILL_TEMPLATES,
  draftFromTemplate,
  sortSkills,
  toSkillInput,
  validateSkillDraft,
} from "./skills";

describe("validateSkillDraft", () => {
  const valid = {
    name: "Weekly digest",
    description: "Summarise the week.",
    instructions: "Do the thing.",
    enabled: true,
  };

  it("accepts a well-formed draft", () => {
    expect(validateSkillDraft(valid)).toEqual({});
  });

  it("requires every field", () => {
    const errors = validateSkillDraft(EMPTY_SKILL_DRAFT);
    expect(Object.keys(errors).sort()).toEqual(["description", "instructions", "name"]);
  });

  it("treats whitespace-only name/description/instructions as empty", () => {
    const errors = validateSkillDraft({
      name: "   ",
      description: " \n ",
      instructions: "\t",
      enabled: true,
    });
    expect(errors.name).toBeDefined();
    expect(errors.description).toBeDefined();
    expect(errors.instructions).toBeDefined();
  });

  it("enforces the name character set and length", () => {
    expect(validateSkillDraft({ ...valid, name: "Digest: weekly!" }).name).toMatch(/letters, numbers/);
    expect(validateSkillDraft({ ...valid, name: "café_notes-2" })).toEqual({});
    expect(validateSkillDraft({ ...valid, name: "x".repeat(SKILL_LIMITS.name.max) })).toEqual({});
    expect(validateSkillDraft({ ...valid, name: "x".repeat(SKILL_LIMITS.name.max + 1) }).name).toMatch(
      /under 60/,
    );
  });

  it("caps description and instructions", () => {
    expect(
      validateSkillDraft({ ...valid, description: "d".repeat(SKILL_LIMITS.description.max + 1) })
        .description,
    ).toMatch(/under 200/);
    expect(
      validateSkillDraft({ ...valid, instructions: "i".repeat(SKILL_LIMITS.instructions.max + 1) })
        .instructions,
    ).toMatch(/32,000/);
  });
});

describe("toSkillInput", () => {
  it("trims name and description but leaves instructions verbatim", () => {
    const input = toSkillInput({
      name: "  Triage ",
      description: " Sort links. ",
      instructions: "  - indented markdown\n",
      enabled: false,
    });
    expect(input).toEqual({
      name: "Triage",
      description: "Sort links.",
      instructions: "  - indented markdown\n",
      enabled: false,
    });
  });
});

describe("SKILL_TEMPLATES", () => {
  it("ships exactly the three contract templates, each a valid draft", () => {
    expect(SKILL_TEMPLATES.map((t) => t.name)).toEqual([
      "Weekly reading digest",
      "Research brief",
      "Link triage",
    ]);
    for (const t of SKILL_TEMPLATES) {
      expect(validateSkillDraft(draftFromTemplate(t))).toEqual({});
      // Templates should reference the tools Ask AI actually has.
      expect(t.instructions).toMatch(/queryDatabase|searchBookmarks|listSessions/);
    }
    expect(new Set(SKILL_TEMPLATES.map((t) => t.id)).size).toBe(3);
  });
});

describe("sortSkills", () => {
  it("orders newest-updated first without mutating the input", () => {
    const base = { description: "", instructions: "", enabled: true, createdAt: "2026-01-01T00:00:00Z" };
    const skills = [
      { ...base, id: "a", name: "A", updatedAt: "2026-01-02T00:00:00Z" },
      { ...base, id: "b", name: "B", updatedAt: "2026-01-05T00:00:00Z" },
      { ...base, id: "c", name: "C", updatedAt: "2026-01-03T00:00:00Z" },
    ];
    const snapshot = [...skills];
    expect(sortSkills(skills).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(skills).toEqual(snapshot);
  });
});
