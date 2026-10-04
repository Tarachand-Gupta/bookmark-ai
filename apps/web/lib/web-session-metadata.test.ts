import { afterEach, describe, expect, it, vi } from "vitest";
import { webSessionMetadata } from "./web-session-metadata";

afterEach(() => vi.unstubAllGlobals());
describe("automatic web session display metadata", () => {
  it("registers Chrome on macOS rather than a generic web device", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36" });
    expect(webSessionMetadata(false)).toEqual({ clientType: "web", deviceName: "Web · Chrome", browser: "Chrome", os: "macOS" });
  });
  it("distinguishes Safari from Chrome despite their shared Safari UA suffix", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15" });
    expect(webSessionMetadata(false)).toEqual({ clientType: "web", deviceName: "Web · Safari", browser: "Safari", os: "macOS" });
  });
  it("labels a standalone iPhone session as PWA while retaining Safari and iOS", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
    expect(webSessionMetadata(true)).toEqual({ clientType: "pwa", deviceName: "PWA · Safari", browser: "Safari", os: "iOS" });
  });
  it("does not invent browser or OS details for an unknown user agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Unknown QA browser" });
    expect(webSessionMetadata(false)).toEqual({ clientType: "web", deviceName: "Web · Browser" });
  });
});
