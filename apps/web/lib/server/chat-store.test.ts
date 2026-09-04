import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, TENANT_MIGRATIONS, type Db } from "@bookmark-ai/db";
import {
  appendChatMessage,
  createConversationRecord,
  deriveConversationTitle,
  hasMeaningfulParts,
  loadConversationRecord,
  mergeConversationMessages,
  messageText,
  messageTitleText,
  pruneEmptyAssistantMessages,
} from "@bookmark-ai/engine";

/**
 * Chat persistence against a REAL in-memory libSQL DB running the tenant
 * migrations. The two rules under test:
 *  - a message id is scoped to its conversation: a client-supplied id that
 *    already lives in ANOTHER conversation gets a fresh id instead of relocating
 *    the old row (QA defect D2), while a same-conversation re-send still upserts;
 *  - an attachment-only first message titles the conversation after the file
 *    (QA defect D5), not "New chat".
 */

let db: Db;
beforeAll(async () => {
  db = createClient({ url: ":memory:" }) as unknown as Db;
  await runMigrations(db, TENANT_MIGRATIONS);
});
afterAll(() => {
  (db as unknown as { close(): void }).close();
});

const text = (t: string) => [{ type: "text", text: t }];

describe("appendChatMessage — ids are scoped to their conversation", () => {
  it("a re-used client id across conversations does NOT relocate the old turn", async () => {
    const a = await createConversationRecord(db, "A");
    const b = await createConversationRecord(db, "B");
    const first = await appendChatMessage(db, a.id, { id: "qa-api-dupid2", role: "user", parts: text("first") });
    expect(first.id).toBe("qa-api-dupid2");
    await appendChatMessage(db, a.id, { id: "asst-a", role: "assistant", parts: text("reply a") });

    // Same client id, different conversation → stored under a fresh id.
    const second = await appendChatMessage(db, b.id, { id: "qa-api-dupid2", role: "user", parts: text("second") });
    expect(second.id).not.toBe("qa-api-dupid2");
    expect(second.id).toMatch(/^[0-9a-f-]{36}$/);

    const storedA = await loadConversationRecord(db, a.id);
    expect(storedA?.messages.map((m) => [m.role, m.id])).toEqual([
      ["user", "qa-api-dupid2"],
      ["assistant", "asst-a"],
    ]);
    const storedB = await loadConversationRecord(db, b.id);
    expect(storedB?.messages.map((m) => m.role)).toEqual(["user"]);
    expect(storedB?.messages[0].parts).toEqual(text("second"));
  });

  it("a same-conversation re-send (retry) upserts in place", async () => {
    const c = await createConversationRecord(db, "C");
    await appendChatMessage(db, c.id, { id: "retry-1", role: "user", parts: text("v1") });
    const again = await appendChatMessage(db, c.id, { id: "retry-1", role: "user", parts: text("v2") });
    expect(again.id).toBe("retry-1");
    const stored = await loadConversationRecord(db, c.id);
    expect(stored?.messages).toHaveLength(1);
    expect(stored?.messages[0].parts).toEqual(text("v2"));
  });

  it("assistant turns get the same guard (a colliding id never moves a row)", async () => {
    const d = await createConversationRecord(db, "D");
    const e = await createConversationRecord(db, "E");
    await appendChatMessage(db, d.id, { id: "asst-shared", role: "assistant", parts: text("d") });
    const moved = await appendChatMessage(db, e.id, { id: "asst-shared", role: "assistant", parts: text("e") });
    expect(moved.id).not.toBe("asst-shared");
    expect((await loadConversationRecord(db, d.id))?.messages.map((m) => m.id)).toEqual(["asst-shared"]);
    expect((await loadConversationRecord(db, e.id))?.messages).toHaveLength(1);
  });

  it("a blank id is minted, never stored as an empty key", async () => {
    const f = await createConversationRecord(db, "F");
    const r1 = await appendChatMessage(db, f.id, { id: "", role: "assistant", parts: text("1") });
    const r2 = await appendChatMessage(db, f.id, { id: "   ", role: "assistant", parts: text("2") });
    expect(r1.id).not.toBe("");
    expect(r1.id).not.toBe(r2.id);
    expect((await loadConversationRecord(db, f.id))?.messages).toHaveLength(2);
  });
});

describe("empty assistant turns (a provider error mid-stream)", () => {
  const stepOnly = [{ type: "step-start" }];

  it("hasMeaningfulParts: content, reasoning, tools, files count; step-start / empty text don't", () => {
    expect(hasMeaningfulParts(undefined)).toBe(false);
    expect(hasMeaningfulParts([])).toBe(false);
    expect(hasMeaningfulParts(stepOnly)).toBe(false);
    expect(hasMeaningfulParts([{ type: "step-start" }, { type: "text", text: "  " }])).toBe(false);
    expect(hasMeaningfulParts([{ type: "text", text: "hi" }])).toBe(true);
    expect(hasMeaningfulParts([{ type: "reasoning", text: "thinking" }])).toBe(true);
    expect(hasMeaningfulParts([{ type: "tool-searchBookmarks", state: "output-error", errorText: "x" }])).toBe(true);
    expect(hasMeaningfulParts([{ type: "dynamic-tool", toolName: "x" }])).toBe(true);
    expect(hasMeaningfulParts([{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" }])).toBe(true);
    expect(hasMeaningfulParts([{ type: "data-custom", data: {} }])).toBe(false);
  });

  it("pruneEmptyAssistantMessages drops only empty ASSISTANT turns", () => {
    const messages = [
      { id: "u1", role: "user", parts: text("q") },
      { id: "a1", role: "assistant", parts: stepOnly },
      { id: "u2", role: "user", parts: [] },
      { id: "a2", role: "assistant", parts: text("answer") },
    ];
    expect(pruneEmptyAssistantMessages(messages).map((m) => m.id)).toEqual(["u1", "u2", "a2"]);
  });

  it("mergeConversationMessages: a regenerate's re-sent user message replaces its stored copy, empty turns vanish", () => {
    const history = [
      { id: "u1", role: "user", parts: text("first") },
      { id: "a1", role: "assistant", parts: text("reply") },
      { id: "u2", role: "user", parts: text("second (stored before the failed turn)") },
      { id: "a2", role: "assistant", parts: stepOnly }, // the failed turn
    ];
    const incoming = [{ id: "u2", role: "user", parts: text("second (re-sent)") }];
    const merged = mergeConversationMessages(history, incoming);
    expect(merged.map((m) => [m.id, m.role])).toEqual([
      ["u1", "user"],
      ["a1", "assistant"],
      ["u2", "user"],
    ]);
    expect(merged[2].parts).toEqual(text("second (re-sent)"));
    // A genuinely new message is simply appended.
    expect(mergeConversationMessages(history, [{ id: "u3", role: "user", parts: text("third") }]).map((m) => m.id)).toEqual(["u1", "a1", "u2", "u3"]);
  });
});

describe("conversation titles", () => {
  it("come from the message text when there is any", () => {
    expect(messageTitleText({ role: "user", parts: [...text("  What did I save about React?  ")] })).toBe("What did I save about React?");
    expect(messageText({ role: "user", parts: [{ type: "file", filename: "README.md", mediaType: "text/markdown", url: "data:text/markdown;base64,IyBoaQ==" }] })).toBe("");
  });

  it("fall back to the first attachment's filename for an attachment-only message", () => {
    const parts = [
      { type: "file", filename: "README.md", mediaType: "text/markdown", url: "data:text/markdown;base64,IyBoaQ==" },
      { type: "file", filename: "notes.txt", mediaType: "text/plain", url: "data:text/plain;base64,aGk=" },
    ];
    expect(messageTitleText({ role: "user", parts })).toBe("README.md");
    expect(deriveConversationTitle(messageTitleText({ role: "user", parts }))).toBe("README.md");
    // Text wins over a filename when both exist; an empty text part doesn't.
    expect(messageTitleText({ role: "user", parts: [{ type: "text", text: " " }, ...parts] })).toBe("README.md");
    expect(messageTitleText({ role: "user", parts: [{ type: "text", text: "Summarise" }, ...parts] })).toBe("Summarise");
  });

  it("uses 'Attachment' for a nameless file and 'New chat' only when there is truly nothing", () => {
    expect(messageTitleText({ role: "user", parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" }] })).toBe("Attachment");
    expect(deriveConversationTitle(messageTitleText({ role: "user", parts: [] }))).toBe("New chat");
    expect(deriveConversationTitle(messageTitleText(undefined))).toBe("New chat");
  });
});
