import { describe, expect, it } from "vitest";
import { displayIdentity, maskAccountEmail, maskEmail } from "./identity";

describe("maskEmail", () => {
  it("keeps the first three local-part chars and the full domain", () => {
    expect(maskEmail("tarachand@purecode.ai")).toBe("tar**@purecode.ai");
    expect(maskEmail("bob@gmail.com")).toBe("bob**@gmail.com");
  });

  it("uses whatever local-part chars exist when it's shorter than three", () => {
    expect(maskEmail("ab@x.com")).toBe("ab**@x.com");
    expect(maskEmail("a@x.com")).toBe("a**@x.com");
  });

  it("returns empty for a malformed address rather than a broken mask", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail("no-at-sign")).toBe("");
    expect(maskEmail("@nolocal.com")).toBe("");
    expect(maskEmail("nodomain@")).toBe("");
  });
});

describe("maskAccountEmail", () => {
  it("shows the first three and last three chars with **** between", () => {
    expect(maskAccountEmail("tarachandragupta2784@gmail.com")).toBe("tar****com");
    expect(maskAccountEmail("bob.smith@company.io")).toBe("bob****.io");
  });

  it("leaves an address of six chars or fewer unmasked", () => {
    expect(maskAccountEmail("a@b.co")).toBe("a@b.co");
    expect(maskAccountEmail("ab@c.d")).toBe("ab@c.d");
    expect(maskAccountEmail("")).toBe("");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskAccountEmail("  tarachand@purecode.ai  ")).toBe("tar****.ai");
  });
});

describe("displayIdentity", () => {
  it("prefers the full name when both parts are present", () => {
    expect(
      displayIdentity({ firstName: "Ada", lastName: "Lovelace", email: "ada@x.com" }),
    ).toBe("Ada Lovelace");
  });

  it("falls back to a masked email when a name part is missing", () => {
    expect(displayIdentity({ firstName: "Ada", email: "ada@example.com" })).toBe("ada**@example.com");
    expect(displayIdentity({ lastName: "Lovelace", email: "ada@example.com" })).toBe("ada**@example.com");
    expect(displayIdentity({ email: "tarachand@purecode.ai" })).toBe("tar**@purecode.ai");
  });

  it("treats whitespace-only name parts as absent", () => {
    expect(displayIdentity({ firstName: "  ", lastName: "  ", email: "bob@gmail.com" })).toBe(
      "bob**@gmail.com",
    );
  });

  it("returns empty when there's neither a full name nor an email", () => {
    expect(displayIdentity({})).toBe("");
    expect(displayIdentity({ firstName: "Ada" })).toBe("");
    expect(displayIdentity({ firstName: null, lastName: null, email: null })).toBe("");
  });
});
