import { describe, expect, it } from "vitest";
import { chatScrollTarget } from "./chat-scroll";

describe("chat bottom scrolling at fractional browser zoom", () => {
  it.each([
    [364, 363.75],
    [1054, 1053.9061279296875],
    [106, 105.5],
  ])("settles at the reachable pixel for target %s and position %s", (target, reached) => {
    // These rounded DOM heights otherwise cause the scroll controller to keep
    // scheduling frames after scrollTop has already stopped moving.
    const next = chatScrollTarget(target, reached);
    expect(reached < next).toBe(false);
    expect(next).toBe(reached);
  });

  it("still reaches the bottom from further away and clamps an overscroll", () => {
    expect(chatScrollTarget(364, 200)).toBe(364);
    expect(chatScrollTarget(364, 362.5)).toBe(364);
    expect(chatScrollTarget(364, 364)).toBe(364);
    expect(chatScrollTarget(364, 365)).toBe(364);
    expect(chatScrollTarget(0, 0)).toBe(0);
  });
});
