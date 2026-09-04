import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_COPY,
  CHAT_ATTACHMENT_RULES,
  attachmentAcceptAttribute,
  attachmentLabel,
  base64DecodedBytes,
  base64LengthFor,
  chooseImageEncoding,
  classifyAttachment,
  dataUrlPayloadLength,
  describeAttachmentServerError,
  extensionOf,
  fitWithinEdge,
  formatBytes,
  planAttachmentBatch,
  renameForMediaType,
  sourceSizeError,
} from "./chat-attachments";

describe("describeAttachmentServerError", () => {
  it("maps every typed server rejection to composer copy", () => {
    expect(describeAttachmentServerError(400, { error: "too-many-attachments", maxFiles: 5 })).toBe(
      "Up to 5 files per message.",
    );
    expect(describeAttachmentServerError(400, { error: "attachment-url-not-allowed", filename: "a.png" })).toBe(
      "“a.png” couldn't be sent — only files from your device can be attached, not links.",
    );
    expect(
      describeAttachmentServerError(413, { error: "attachments-too-large", limitBytes: 2 * 1024 * 1024, filename: "big.jpg" }),
    ).toBe("“big.jpg” is too large (limit 2 MB).");
    expect(describeAttachmentServerError(413, { error: "attachments-too-large", limitBytes: 4 * 1024 * 1024 })).toBe(
      ATTACHMENT_COPY.totalTooLarge,
    );
    expect(
      describeAttachmentServerError(415, { error: "attachment-type-not-allowed", filename: "app.ts", mediaType: "text/plain" }),
    ).toBe(`“app.ts” isn't an allowed type. ${ATTACHMENT_COPY.disallowed}`);
  });

  it("leaves unrelated failures to the generic path, except a bare 413", () => {
    expect(describeAttachmentServerError(500, { error: "boom" })).toBeNull();
    expect(describeAttachmentServerError(402, { error: "free-limit-exceeded" })).toBeNull();
    expect(describeAttachmentServerError(400, null)).toBeNull();
    expect(describeAttachmentServerError(413, null)).toBe(ATTACHMENT_COPY.totalTooLarge);
  });
});

describe("extensionOf", () => {
  it("lower-cases and handles paths, dotfiles and missing extensions", () => {
    expect(extensionOf("Notes.MD")).toBe(".md");
    expect(extensionOf("/tmp/dir.with.dots/report.final.PDF")).toBe(".pdf");
    expect(extensionOf("C:\\Users\\me\\photo.JPG")).toBe(".jpg");
    expect(extensionOf(".bashrc")).toBe("");
    expect(extensionOf("README")).toBe("");
    expect(extensionOf("trailing.")).toBe("");
  });
});

describe("classifyAttachment", () => {
  it("maps by extension FIRST, ignoring an unreliable reported MIME", () => {
    expect(classifyAttachment("notes.md", "text/plain")).toEqual({
      kind: "document",
      mediaType: "text/markdown",
    });
    expect(classifyAttachment("notes.md", "")).toEqual({ kind: "document", mediaType: "text/markdown" });
    expect(classifyAttachment("data.json", "application/octet-stream")).toEqual({
      kind: "document",
      mediaType: "application/json",
    });
    expect(classifyAttachment("shot.JPEG", null)).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(classifyAttachment("paper.pdf", "application/pdf")).toEqual({
      kind: "pdf",
      mediaType: "application/pdf",
    });
  });

  it("falls back to the reported MIME when the name has no extension (clipboard pastes)", () => {
    expect(classifyAttachment("image", "image/png")).toEqual({ kind: "image", mediaType: "image/png" });
    expect(classifyAttachment("", "text/plain; charset=utf-8")).toEqual({
      kind: "document",
      mediaType: "text/plain",
    });
    expect(classifyAttachment("blob", "IMAGE/WEBP")).toEqual({ kind: "image", mediaType: "image/webp" });
  });

  it("rejects code, media, archives, executables and svg with the contract copy", () => {
    for (const name of [
      "app.js",
      "types.ts",
      "view.tsx",
      "script.py",
      "run.sh",
      "main.go",
      "lib.rs",
      "Main.java",
      "a.c",
      "b.cpp",
      "c.h",
      "App.swift",
      "index.php",
      "site.css",
      "feed.xml",
      "conf.yaml",
      "conf.yml",
      "logo.svg",
      "clip.mp4",
      "song.mp3",
      "bundle.zip",
      "setup.exe",
    ]) {
      expect(classifyAttachment(name, null)).toEqual({
        kind: "rejected",
        reason: ATTACHMENT_COPY.disallowed,
      });
    }
  });

  it("does not let a friendly MIME rescue a code extension", () => {
    expect(classifyAttachment("notes.js", "text/plain")).toEqual({
      kind: "rejected",
      reason: ATTACHMENT_COPY.disallowed,
    });
    expect(classifyAttachment("icon.svg", "image/svg+xml")).toEqual({
      kind: "rejected",
      reason: ATTACHMENT_COPY.disallowed,
    });
  });

  it("rejects an unknown MIME with no extension", () => {
    expect(classifyAttachment("", null).kind).toBe("rejected");
    expect(classifyAttachment("", "video/webm").kind).toBe("rejected");
  });

  it("is the SHARED classifier — the same one the server enforces with", async () => {
    const shared = await import("@bookmark-ai/types");
    expect(classifyAttachment).toBe(shared.classifyAttachment);
    expect(CHAT_ATTACHMENT_RULES).toBe(shared.CHAT_ATTACHMENT_RULES);
    expect(ATTACHMENT_COPY.disallowed).toBe(shared.ATTACHMENT_REJECTED_MESSAGE);
    expect(ATTACHMENT_COPY.imageTooLarge).toBe(shared.ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE);
    expect(ATTACHMENT_COPY.totalTooLarge).toBe(shared.ATTACHMENTS_TOO_LARGE_MESSAGE);
  });
});

describe("attachmentAcceptAttribute", () => {
  it("lists every allowed extension and MIME exactly once", () => {
    const accept = attachmentAcceptAttribute().split(",");
    expect(new Set(accept).size).toBe(accept.length);
    for (const ext of Object.keys(CHAT_ATTACHMENT_RULES.extensionToMediaType)) {
      expect(accept).toContain(ext);
    }
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("image/webp");
    expect(accept).not.toContain(".svg");
  });
});

describe("sourceSizeError", () => {
  it("applies the per-kind picker caps", () => {
    expect(sourceSizeError("image", 10 * 1024 * 1024)).toBeNull();
    expect(sourceSizeError("image", 10 * 1024 * 1024 + 1)).toBe(ATTACHMENT_COPY.imageSourceTooLarge);
    expect(sourceSizeError("document", 1024 * 1024 + 1)).toBe(ATTACHMENT_COPY.documentTooLarge);
    expect(sourceSizeError("pdf", 3 * 1024 * 1024)).toBeNull();
    expect(sourceSizeError("pdf", 3 * 1024 * 1024 + 1)).toBe(ATTACHMENT_COPY.pdfTooLarge);
  });
});

describe("fitWithinEdge", () => {
  it("leaves small images alone and never upscales", () => {
    expect(fitWithinEdge(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(fitWithinEdge(1568, 1000)).toEqual({ width: 1568, height: 1000, scale: 1 });
  });

  it("scales the longest edge to 1568 and keeps the aspect ratio", () => {
    const landscape = fitWithinEdge(4000, 3000);
    expect(landscape.width).toBe(1568);
    expect(landscape.height).toBe(1176);
    const portrait = fitWithinEdge(3000, 4000);
    expect(portrait.height).toBe(1568);
    expect(portrait.width).toBe(1176);
    const square = fitWithinEdge(5000, 5000);
    expect(square).toMatchObject({ width: 1568, height: 1568 });
  });

  it("floors extreme aspect ratios at 1px and survives garbage", () => {
    expect(fitWithinEdge(100_000, 10).height).toBe(1);
    expect(fitWithinEdge(0, 0)).toEqual({ width: 1, height: 1, scale: 1 });
    expect(fitWithinEdge(Number.NaN, 10)).toEqual({ width: 1, height: 1, scale: 1 });
  });
});

describe("base64 accounting", () => {
  it("counts only the payload of a data URL", () => {
    expect(dataUrlPayloadLength("data:image/png;base64,AAAA")).toBe(4);
    expect(dataUrlPayloadLength("data:text/plain,hello")).toBe(5);
    expect(dataUrlPayloadLength("blob:http://localhost/abc")).toBe(0);
    expect(dataUrlPayloadLength("data:")).toBe(0);
  });

  it("round-trips lengths", () => {
    expect(base64LengthFor(0)).toBe(0);
    expect(base64LengthFor(1)).toBe(4);
    expect(base64LengthFor(3)).toBe(4);
    expect(base64LengthFor(4)).toBe(8);
    expect(base64LengthFor(3 * 1024 * 1024)).toBe(4 * 1024 * 1024);
    expect(base64DecodedBytes(8, "data:x;base64,AAAAAAA=")).toBe(5);
    expect(base64DecodedBytes(8, "data:x;base64,AAAAAA==")).toBe(4);
    expect(base64DecodedBytes(8)).toBe(6);
    expect(base64DecodedBytes(0)).toBe(0);
  });

  it("a 3 MB PDF (the cap) fits exactly inside the 4 MB body budget", () => {
    expect(base64LengthFor(CHAT_ATTACHMENT_RULES.pdf.maxBytes)).toBeLessThanOrEqual(
      CHAT_ATTACHMENT_RULES.maxTotalEncodedBytes,
    );
  });
});

describe("formatBytes", () => {
  it("picks sensible units", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(340 * 1024)).toBe("340 KB");
    expect(formatBytes(1.24 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatBytes(12.6 * 1024 * 1024)).toBe("13 MB");
  });
});

describe("planAttachmentBatch", () => {
  const one = (payloadLength: number, name: string) => ({ payloadLength, name });

  it("accepts everything within the caps", () => {
    const plan = planAttachmentBatch([], [one(100, "a"), one(200, "b")]);
    expect(plan.accepted.map((f) => f.name)).toEqual(["a", "b"]);
    expect(plan.errors).toEqual([]);
  });

  it("stops at 5 files counting what is already attached, reporting once", () => {
    const existing = [one(1, "e1"), one(1, "e2"), one(1, "e3"), one(1, "e4")];
    const plan = planAttachmentBatch(existing, [one(1, "a"), one(1, "b"), one(1, "c")]);
    expect(plan.accepted.map((f) => f.name)).toEqual(["a"]);
    expect(plan.errors).toEqual([ATTACHMENT_COPY.tooManyFiles]);
  });

  it("enforces the 4 MB total payload across existing + incoming, keeping earlier files", () => {
    const mb = 1024 * 1024;
    const plan = planAttachmentBatch([one(3 * mb, "existing")], [
      one(0.5 * mb, "fits"),
      one(1 * mb, "too-big"),
      one(0.4 * mb, "fits-too"),
    ]);
    expect(plan.accepted.map((f) => f.name)).toEqual(["fits", "fits-too"]);
    expect(plan.errors).toEqual([ATTACHMENT_COPY.totalTooLarge]);
  });

  it("reports both overflow reasons, each once", () => {
    const mb = 1024 * 1024;
    const plan = planAttachmentBatch(
      [one(1, "e1"), one(1, "e2"), one(1, "e3"), one(1, "e4")],
      [one(5 * mb, "huge"), one(1, "sixth"), one(1, "seventh")],
    );
    expect(plan.accepted.map((f) => f.name)).toEqual(["sixth"]);
    expect(plan.errors).toEqual([ATTACHMENT_COPY.totalTooLarge, ATTACHMENT_COPY.tooManyFiles]);
  });
});

describe("chooseImageEncoding", () => {
  it("passes GIFs through, keeps PNG for transparency, else JPEG 0.85", () => {
    expect(chooseImageEncoding("image/gif", false)).toEqual({ mediaType: "image/gif", passthrough: true });
    expect(chooseImageEncoding("image/png", true)).toEqual({ mediaType: "image/png", passthrough: false });
    expect(chooseImageEncoding("image/png", false)).toEqual({
      mediaType: "image/jpeg",
      quality: 0.85,
      passthrough: false,
    });
    expect(chooseImageEncoding("image/webp", false).mediaType).toBe("image/jpeg");
  });
});

describe("labels", () => {
  it("names nameless pastes by kind", () => {
    expect(attachmentLabel("shot.png", "image/png")).toBe("shot.png");
    expect(attachmentLabel("", "image/png")).toBe("Pasted image");
    expect(attachmentLabel(undefined, "text/plain")).toBe("Pasted text");
    expect(attachmentLabel("  ", "application/pdf")).toBe("Document.pdf");
  });

  it("renames a re-encoded image to match its new format", () => {
    expect(renameForMediaType("photo.png", "image/jpeg")).toBe("photo.jpg");
    expect(renameForMediaType("photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
    expect(renameForMediaType("photo.JPG", "image/jpeg")).toBe("photo.JPG");
    expect(renameForMediaType("shot", "image/png")).toBe("shot.png");
    expect(renameForMediaType("anim.gif", "image/gif")).toBe("anim.gif");
  });
});
