import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { ToolCallCard, type AnyToolPart } from "@/components/library/chat-tool-card";
import { ChatMessageSources } from "@/components/library/chat-message-sources";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("chat result disclosure", () => {
  it("keeps SQL, result tables and raw payloads out of the initial transcript", () => {
    const markup = renderToStaticMarkup(
      createElement(ToolCallCard, {
        part: {
          type: "tool-queryDatabase",
          toolCallId: "sql",
          state: "output-available",
          input: { sql: "SELECT category FROM bookmarks", purpose: "Compare saved categories" },
          output: { columns: ["category"], rows: [["Research"]], rowCount: 1 },
        } as AnyToolPart,
      }),
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Library query");
    expect(markup).toContain("Compare saved categories");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("SELECT category");
    expect(markup).not.toContain("Technical details");
    expect(markup).not.toContain("Research");
  });
  it("provides useful running and error labels without exposing raw output", () => {
    for (const state of ["input-streaming", "output-error"] as const) {
      const markup = renderToStaticMarkup(
        createElement(ToolCallCard, {
          part: {
            type: "tool-fetchUrl",
            toolCallId: "url",
            state,
            input: { url: "https://example.invalid" },
            ...(state === "output-error" ? { errorText: "Private diagnostic output" } : {}),
          } as AnyToolPart,
        }),
      );
      expect(markup).toContain('aria-expanded="false"');
      expect(markup).not.toContain("Private diagnostic output");
      expect(markup).toContain(state === "output-error" ? "Failed" : "Running");
    }
  });
  it("does not label the default library as an empty attachment", () => {
    expect(
      renderToStaticMarkup(createElement(ChatMessageSources, { context: { type: "library" } })),
    ).toBe("");
    const markup = renderToStaticMarkup(
      createElement(ChatMessageSources, {
        context: { type: "bookmarks", bookmarkIds: ["a"] },
        sources: [{ id: "a", title: "Attached note", url: "javascript:alert(1)" }],
      }),
    );
    expect(markup).toContain("1 attached bookmark");
    expect(markup).toContain("Full library available");
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain("open=");
  });
});
