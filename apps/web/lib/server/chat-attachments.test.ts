import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_REJECTED_MESSAGE,
  CHAT_ATTACHMENT_RULES,
  classifyAttachment,
} from "@bookmark-ai/types";
import {
  dataUrlPayload,
  decodedByteLength,
  normalizeAttachmentsForModel,
  validateChatAttachments,
} from "./chat-attachments";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const dataUrl = (mediaType: string, bytes: number | string) =>
  `data:${mediaType};base64,${typeof bytes === "string" ? b64(bytes) : Buffer.alloc(bytes, 1).toString("base64")}`;

function userMessage(parts: unknown[]): UIMessage {
  return { id: "u1", role: "user", parts: parts as UIMessage["parts"] };
}
const file = (filename: string, mediaType: string, url: string) => ({ type: "file", filename, mediaType, url });

describe("classifyAttachment", () => {
  it.each([
    ["photo.png", "image/png", "image", "image/png"],
    ["photo.JPG", "image/jpeg", "image", "image/jpeg"],
    ["photo.jpeg", "", "image", "image/jpeg"],
    ["anim.gif", "image/gif", "image", "image/gif"],
    ["pic.webp", "image/webp", "image", "image/webp"],
    ["notes.md", "text/plain", "document", "text/markdown"], // extension beats the OS MIME
    ["notes.markdown", null, "document", "text/markdown"],
    ["readme.txt", "text/plain", "document", "text/plain"],
    ["data.csv", "application/vnd.ms-excel", "document", "text/csv"],
    ["page.html", "text/html", "document", "text/html"],
    ["page.htm", "", "document", "text/html"],
    ["config.json", "application/json", "document", "application/json"],
    ["paper.pdf", "application/pdf", "pdf", "application/pdf"],
    ["paper.pdf", "application/octet-stream", "pdf", "application/pdf"],
  ] as const)("accepts %s (%s) as %s", (filename, mime, kind, mediaType) => {
    expect(classifyAttachment(filename, mime)).toEqual({ kind, mediaType });
  });

  it.each([
    "index.js", "app.ts", "view.jsx", "view.tsx", "run.py", "run.sh", "gem.rb", "main.go", "lib.rs",
    "Main.java", "a.c", "a.cpp", "a.h", "App.swift", "index.php", "site.css", "data.xml",
    "cfg.yaml", "cfg.yml", "icon.svg", "clip.mp4", "song.mp3", "bundle.zip", "setup.exe", "archive.tar.gz",
  ])("rejects %s even when the reported MIME is allowed", (filename) => {
    const r = classifyAttachment(filename, "text/plain");
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toBe(ATTACHMENT_REJECTED_MESSAGE);
  });

  it("falls back to the reported MIME only when there is no extension", () => {
    expect(classifyAttachment("", "image/png")).toEqual({ kind: "image", mediaType: "image/png" });
    expect(classifyAttachment("clipboard", "image/jpeg; charset=binary")).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(classifyAttachment("blob", "text/markdown")).toEqual({ kind: "document", mediaType: "text/markdown" });
    expect(classifyAttachment("blob", "video/mp4").kind).toBe("rejected");
    expect(classifyAttachment("blob", "image/svg+xml").kind).toBe("rejected");
    expect(classifyAttachment("", null).kind).toBe("rejected");
    expect(classifyAttachment("", "garbage").kind).toBe("rejected");
  });

  it("treats a path as its basename and ignores dotfiles' leading dot", () => {
    expect(classifyAttachment("/tmp/x/notes.md", null).kind).toBe("document");
    expect(classifyAttachment(".env", "text/plain").kind).toBe("rejected");
  });
});

describe("dataUrlPayload / decodedByteLength", () => {
  it("parses base64 data URLs and refuses everything else", () => {
    expect(dataUrlPayload("data:text/plain;base64,aGk=")).toEqual({ mediaType: "text/plain", base64: "aGk=" });
    expect(dataUrlPayload("data:image/png;name=x.png;base64,AAAA")).toEqual({ mediaType: "image/png", base64: "AAAA" });
    expect(dataUrlPayload("https://example.com/a.png")).toBeNull();
    expect(dataUrlPayload("data:text/plain,hello")).toBeNull();
    expect(dataUrlPayload("")).toBeNull();
  });

  it("computes decoded sizes without decoding", () => {
    for (const n of [0, 1, 2, 3, 4, 100, 1023, 1024]) {
      expect(decodedByteLength(Buffer.alloc(n).toString("base64"))).toBe(n);
    }
  });
});

describe("validateChatAttachments", () => {
  const png = () => file("a.png", "image/png", dataUrl("image/png", 1024));

  it("passes messages without files and non-user messages untouched", () => {
    expect(validateChatAttachments([userMessage([{ type: "text", text: "hi" }])])).toEqual({ ok: true });
    expect(
      validateChatAttachments([
        { id: "a1", role: "assistant", parts: [file("x.exe", "application/x-msdownload", "data:x;base64,AA==")] as UIMessage["parts"] },
      ]),
    ).toEqual({ ok: true });
  });

  it("accepts allowed files within limits", () => {
    expect(
      validateChatAttachments([
        userMessage([
          { type: "text", text: "see" },
          png(),
          file("notes.md", "text/plain", dataUrl("text/plain", "# hi")),
          file("paper.pdf", "application/pdf", dataUrl("application/pdf", 2048)),
        ]),
      ]),
    ).toEqual({ ok: true });
  });

  it("415s a disallowed type with filename + reported media type", () => {
    const r = validateChatAttachments([userMessage([file("app.ts", "text/plain", dataUrl("text/plain", "x"))])]);
    expect(r).toEqual({
      ok: false,
      status: 415,
      body: { error: "attachment-type-not-allowed", filename: "app.ts", mediaType: "text/plain" },
    });
  });

  it("413s a single file over its per-kind limit", () => {
    const tooBig = file("a.png", "image/png", dataUrl("image/png", CHAT_ATTACHMENT_RULES.image.maxEncodedBytes + 1));
    const r = validateChatAttachments([userMessage([tooBig])]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(413);
      expect(r.body).toMatchObject({ error: "attachments-too-large", limitBytes: CHAT_ATTACHMENT_RULES.image.maxEncodedBytes });
    }
    const doc = file("a.txt", "text/plain", dataUrl("text/plain", CHAT_ATTACHMENT_RULES.document.maxBytes + 1));
    const d = validateChatAttachments([userMessage([doc])]);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.body).toMatchObject({ limitBytes: CHAT_ATTACHMENT_RULES.document.maxBytes });
  });

  it("413s when the message total exceeds 4 MB even if each file is fine", () => {
    const pdf = () => file("p.pdf", "application/pdf", dataUrl("application/pdf", 1.5 * 1024 * 1024));
    const r = validateChatAttachments([userMessage([pdf(), pdf(), pdf()])]);
    expect(r).toEqual({
      ok: false,
      status: 413,
      body: { error: "attachments-too-large", limitBytes: CHAT_ATTACHMENT_RULES.maxTotalEncodedBytes },
    });
  });

  it("400s more than 5 files", () => {
    const r = validateChatAttachments([userMessage([png(), png(), png(), png(), png(), png()])]);
    expect(r).toEqual({ ok: false, status: 400, body: { error: "too-many-attachments", maxFiles: 5 } });
  });

  it("400s a hosted (non-data) URL — the server must never fetch it", () => {
    const r = validateChatAttachments([userMessage([file("a.png", "image/png", "https://evil.example/a.png")])]);
    expect(r).toEqual({ ok: false, status: 400, body: { error: "attachment-url-not-allowed", filename: "a.png" } });
  });
});

describe("normalizeAttachmentsForModel", () => {
  it("inlines documents as <attachment> blocks on the text part and keeps images/PDFs as files", () => {
    const messages = [
      userMessage([
        { type: "text", text: "Summarise this" },
        file("notes.md", "text/plain", dataUrl("text/plain", "# Title\r\nline")),
        file("a.png", "image/png; charset=binary", dataUrl("image/png", 16)),
        file("p.pdf", "application/pdf", dataUrl("application/pdf", 16)),
      ]),
    ];
    const out = normalizeAttachmentsForModel(messages);
    const parts = out[0].parts as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({
      type: "text",
      text: 'Summarise this\n\n<attachment name="notes.md" type="text/markdown">\n# Title\nline\n</attachment>',
    });
    expect(parts[1]).toMatchObject({ type: "file", filename: "a.png", mediaType: "image/png" });
    expect(parts[2]).toMatchObject({ type: "file", filename: "p.pdf", mediaType: "application/pdf" });
    // The input is not mutated (the stored message keeps its original parts).
    expect(messages[0].parts).toHaveLength(4);
  });

  it("adds a text part when the message had none", () => {
    const out = normalizeAttachmentsForModel([userMessage([file("d.json", "application/json", dataUrl("application/json", '{"a":1}'))])]);
    expect(out[0].parts).toEqual([{ type: "text", text: '<attachment name="d.json" type="application/json">\n{"a":1}\n</attachment>' }]);
  });

  it("escapes the filename attribute and leaves other messages alone", () => {
    const assistant: UIMessage = { id: "a", role: "assistant", parts: [{ type: "text", text: "ok" }] };
    const out = normalizeAttachmentsForModel([
      assistant,
      userMessage([file('x"<y>.txt', "text/plain", dataUrl("text/plain", "z"))]),
    ]);
    expect(out[0]).toBe(assistant);
    expect((out[1].parts[0] as { text: string }).text).toContain('name="x&quot;&lt;y&gt;.txt"');
  });
});
