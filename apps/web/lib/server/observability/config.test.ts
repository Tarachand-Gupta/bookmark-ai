import { describe, expect, it } from "vitest";
import { updateObservabilitySchema } from "@bookmark-ai/types";
import { withObservabilityDefaults } from "@/lib/server/observability/config";

/** Pure parse/merge behavior of the observability config (the master-DB read
 * path feeds stored JSON through withObservabilityDefaults). */
describe("withObservabilityDefaults", () => {
  it("defaults every surface ON when nothing is stored", () => {
    expect(withObservabilityDefaults(null)).toEqual({
      askAi: true,
      sessionSummary: true,
      categorize: true,
      embed: true,
      search: true,
    });
  });

  it("merges a stored subset over the defaults", () => {
    expect(withObservabilityDefaults('{"askAi":false,"embed":false}')).toEqual({
      askAi: false,
      sessionSummary: true,
      categorize: true,
      embed: false,
      search: true,
    });
  });

  it("ignores unknown keys and non-boolean values", () => {
    const merged = withObservabilityDefaults('{"askAi":"nope","bogus":true,"search":false}');
    expect(merged).toEqual({
      askAi: true, // non-boolean → default
      sessionSummary: true,
      categorize: true,
      embed: true,
      search: false,
    });
    expect("bogus" in merged).toBe(false);
  });

  it("degrades corrupt JSON to the defaults", () => {
    expect(withObservabilityDefaults("{not json")).toEqual(withObservabilityDefaults(null));
  });
});

describe("updateObservabilitySchema", () => {
  it("accepts a partial flag set", () => {
    expect(updateObservabilitySchema.parse({ embed: false })).toEqual({ embed: false });
  });

  it("rejects an empty body", () => {
    expect(updateObservabilitySchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-boolean flags and unknown keys pass-through", () => {
    expect(updateObservabilitySchema.safeParse({ embed: "off" }).success).toBe(false);
    // Unknown keys are stripped by zod, leaving an empty object → rejected.
    expect(updateObservabilitySchema.safeParse({ bogus: true }).success).toBe(false);
  });
});
