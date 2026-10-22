import { describe, expect, it } from "vitest";
import { parseFloatingAiPreferences } from "./floating-ai-preferences";

describe("floating AI visibility", () => {
  it("defaults to visible on desktop and hidden on mobile", () => {
    expect(parseFloatingAiPreferences(null)).toEqual({ desktop: true, mobile: false });
  });
  it("retains independent choices for each screen size", () => {
    expect(parseFloatingAiPreferences('{"desktop":false,"mobile":true}')).toEqual({ desktop: false, mobile: true });
  });
  it("uses defaults for missing or invalid fields without losing valid choices", () => {
    expect(parseFloatingAiPreferences('{"desktop":false}')).toEqual({ desktop: false, mobile: false });
    expect(parseFloatingAiPreferences('{"desktop":"false","mobile":true}')).toEqual({ desktop: true, mobile: true });
  });
  it.each(["broken", "null", "[]", "1", '"false"'])("tolerates invalid stored preferences: %s", value => {
    expect(parseFloatingAiPreferences(value)).toEqual({ desktop: true, mobile: false });
  });
});
