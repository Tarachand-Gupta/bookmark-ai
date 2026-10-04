import { describe, it, expect, vi } from "vitest";
import { hasValidLangfuseConfig, initializeOptionalTelemetry } from "./optional-config";
const keys = { NODE_ENV: "test" as const, LANGFUSE_PUBLIC_KEY: "pk-lf-test", LANGFUSE_SECRET_KEY: "sk-lf-test" };
describe("optional Langfuse startup", () => {
  it("accepts the SDK default and valid configured regions", () => {
    expect(hasValidLangfuseConfig(keys)).toBe(true);
    expect(hasValidLangfuseConfig({ ...keys, LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com" })).toBe(true);
  });
  it("rejects missing credentials and the actual deployment placeholder failure", () => {
    expect(hasValidLangfuseConfig({ NODE_ENV: "test" })).toBe(false);
    expect(hasValidLangfuseConfig({ ...keys, LANGFUSE_BASE_URL: "[SENSITIVE]" })).toBe(false);
    expect(hasValidLangfuseConfig({ ...keys, LANGFUSE_SECRET_KEY: "[REDACTED]" })).toBe(false);
  });
  it("rejects malformed, unsupported and credential-bearing exporter URLs", () => {
    for (const value of ["not a URL", "file:///tmp/traces", "https://user:secret@example.com"]) expect(hasValidLangfuseConfig({ ...keys, LANGFUSE_BASE_URL: value })).toBe(false);
  });
  it("contains exporter construction failure without exposing its message", () => {
    const warning = vi.fn();
    expect(() => initializeOptionalTelemetry(() => { throw new Error("private exporter value"); }, warning)).not.toThrow();
    expect(warning).toHaveBeenCalledWith();
  });
  it("preserves successful monitoring initialization", () => {
    const initialize = vi.fn(), warning = vi.fn();
    initializeOptionalTelemetry(initialize, warning);
    expect(initialize).toHaveBeenCalledOnce(); expect(warning).not.toHaveBeenCalled();
  });
});
