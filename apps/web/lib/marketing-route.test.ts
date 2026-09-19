import { describe, expect, it } from "vitest";
import { signedInRootDestination } from "./marketing-route";

describe("signedInRootDestination", () => {
  it("keeps the normal signed-in root redirect", () => {
    expect(signedInRootDestination({})).toBe("/app");
  });

  it("preserves legacy and repeated query parameters", () => {
    expect(
      signedInRootDestination({ section: "sessions", tag: ["design", "reference"] }),
    ).toBe("/app?section=sessions&tag=design&tag=reference");
  });

  it("allows only the exact website intent to stay on marketing", () => {
    expect(signedInRootDestination({ view: "website" })).toBeNull();
    expect(signedInRootDestination({ view: "Website" })).toBe("/app?view=Website");
    expect(signedInRootDestination({ view: ["website"] })).toBe("/app?view=website");
  });
});
