import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE,
  ATTACHMENT_REJECTED_MESSAGE,
  ATTACHMENTS_TOO_LARGE_MESSAGE,
  ATTACHMENTS_TOO_MANY_MESSAGE,
  CHAT_ATTACHMENT_RULES,
  classifyAttachment,
} from "@bookmark-ai/types";
import {
  FILES_FAILED_MESSAGE,
  PHOTO_LIBRARY_FAILED_MESSAGE,
  PHOTO_LIBRARY_UNAVAILABLE_MESSAGE,
  PickerError,
  acceptAttachments,
  attachmentFilename,
  attachmentKindOf,
  base64ByteLength,
  canSendTurn,
  dataUrl,
  dataUrlPayloadLength,
  fileGlyph,
  fileTypeLabel,
  formatBytes,
  pickerErrorMessage,
  remainingSlots,
  sendPayload,
  toFileParts,
  tooLargeMessage,
  type PendingAttachment,
} from "./chatAttachments";

function pending(overrides: Partial<PendingAttachment> & { payloadLength?: number } = {}): PendingAttachment {
  const { payloadLength = 4, ...rest } = overrides;
  return {
    id: rest.id ?? "a",
    kind: rest.kind ?? "document",
    filename: rest.filename ?? "notes.md",
    mediaType: rest.mediaType ?? "text/markdown",
    url: rest.url ?? dataUrl("text/markdown", "A".repeat(payloadLength)),
    bytes: rest.bytes ?? Math.floor((payloadLength * 3) / 4),
    ...rest,
  };
}

describe("base64ByteLength", () => {
  it("honours padding", () => {
    assert.equal(base64ByteLength("TQ=="), 1);
    assert.equal(base64ByteLength("TWE="), 2);
    assert.equal(base64ByteLength("TWFu"), 3);
  });
  it("handles unpadded and whitespace-wrapped input", () => {
    assert.equal(base64ByteLength("TWFuTQ"), 4);
    assert.equal(base64ByteLength("TWFu\nTQ==\n"), 4);
    assert.equal(base64ByteLength(""), 0);
  });
});

describe("dataUrlPayloadLength", () => {
  it("measures only the base64 payload", () => {
    assert.equal(dataUrlPayloadLength("data:image/png;base64,AAAA"), 4);
    assert.equal(dataUrlPayloadLength(dataUrl("text/plain", "x".repeat(100))), 100);
  });
  it("is 0 for something that is not a data URL", () => {
    assert.equal(dataUrlPayloadLength("https://example.com/a.png"), 0);
  });
});

describe("classifyAttachment (contract sanity, extension first)", () => {
  it("maps .md to markdown even when the OS reports text/plain", () => {
    assert.deepEqual(classifyAttachment("notes.md", "text/plain"), {
      kind: "document",
      mediaType: "text/markdown",
    });
  });
  it("rejects code and svg with the verbatim copy", () => {
    for (const name of ["script.js", "app.tsx", "main.py", "logo.svg", "run.sh"]) {
      assert.deepEqual(classifyAttachment(name, "text/plain"), {
        kind: "rejected",
        reason: ATTACHMENT_REJECTED_MESSAGE,
      });
    }
  });
  it("falls back to the reported MIME only without an extension", () => {
    assert.deepEqual(classifyAttachment("clipboard", "text/markdown; charset=utf-8"), {
      kind: "document",
      mediaType: "text/markdown",
    });
    assert.equal(classifyAttachment("clipboard", "video/mp4").kind, "rejected");
  });
  it("accepts pdf and images", () => {
    assert.deepEqual(classifyAttachment("paper.PDF", null), {
      kind: "pdf",
      mediaType: "application/pdf",
    });
    assert.deepEqual(classifyAttachment("shot.JPEG", null), {
      kind: "image",
      mediaType: "image/jpeg",
    });
  });
});

describe("acceptAttachments", () => {
  it("caps the count at maxFiles and says so", () => {
    const existing = [1, 2, 3, 4].map((i) => pending({ id: `e${i}` }));
    const { accepted, rejected } = acceptAttachments(existing, [
      pending({ id: "n1" }),
      pending({ id: "n2" }),
    ]);
    assert.deepEqual(
      accepted.map((a) => a.id),
      ["n1"],
    );
    assert.equal(rejected, ATTACHMENTS_TOO_MANY_MESSAGE);
    assert.equal(remainingSlots(existing), 1);
    assert.equal(CHAT_ATTACHMENT_RULES.maxFiles, 5);
  });

  it("caps the total base64 payload at 4 MB, still taking a later file that fits", () => {
    const mb = 1024 * 1024;
    const existing = [pending({ id: "big", payloadLength: 3 * mb })];
    const { accepted, rejected } = acceptAttachments(existing, [
      pending({ id: "too-much", payloadLength: 1.5 * mb }),
      pending({ id: "small", payloadLength: 0.5 * mb }),
    ]);
    assert.deepEqual(
      accepted.map((a) => a.id),
      ["small"],
    );
    assert.equal(rejected, ATTACHMENTS_TOO_LARGE_MESSAGE);
  });

  it("accepts everything when nothing is violated", () => {
    const { accepted, rejected } = acceptAttachments([], [pending({ id: "x" }), pending({ id: "y" })]);
    assert.equal(accepted.length, 2);
    assert.equal(rejected, null);
  });
});

describe("tooLargeMessage", () => {
  it("uses the contract copy for images and mirrors it for other kinds", () => {
    assert.equal(tooLargeMessage("image", 2 * 1024 * 1024), ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE);
    assert.equal(tooLargeMessage("pdf", 3 * 1024 * 1024), "PDF is too large (max 3 MB).");
    assert.equal(tooLargeMessage("document", 1024 * 1024), "Document is too large (max 1 MB).");
  });
});

describe("formatBytes", () => {
  it("picks a unit a person would", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5 MB");
    assert.equal(formatBytes(12 * 1024 * 1024), "12 MB");
    assert.equal(formatBytes(-1), "");
  });
});

describe("toFileParts / kinds / labels", () => {
  it("emits standard AI SDK file parts", () => {
    const [part] = toFileParts([pending({ filename: "a.md", url: "data:text/markdown;base64,QQ==" })]);
    assert.deepEqual(part, {
      type: "file",
      mediaType: "text/markdown",
      filename: "a.md",
      url: "data:text/markdown;base64,QQ==",
    });
  });
  it("buckets media types", () => {
    assert.equal(attachmentKindOf("image/webp"), "image");
    assert.equal(attachmentKindOf("application/pdf"), "pdf");
    assert.equal(attachmentKindOf("text/csv"), "document");
    assert.equal(attachmentKindOf("video/mp4"), "other");
  });
  it("labels and glyphs", () => {
    assert.equal(fileTypeLabel("text/markdown"), "Markdown");
    assert.equal(fileTypeLabel("application/pdf"), "PDF");
    assert.equal(fileTypeLabel("application/octet-stream", "weird.bin"), "BIN");
    assert.equal(fileGlyph("application/pdf").symbol, "doc.richtext");
    assert.equal(fileGlyph("text/plain").symbol, "doc.text");
  });
});

describe("attachmentFilename", () => {
  it("swaps the extension to match the re-encoded image format", () => {
    assert.equal(attachmentFilename("IMG_0001.HEIC", "image/jpeg"), "IMG_0001.jpg");
    assert.equal(attachmentFilename("shot.png", "image/png"), "shot.png");
    assert.equal(attachmentFilename("/tmp/dir/photo.webp", "image/jpeg"), "photo.jpg");
  });
  it("invents a stem when the picker gave none", () => {
    assert.match(attachmentFilename(null, "image/png"), /^photo-\d+\.png$/);
    assert.match(attachmentFilename("", "image/jpeg"), /^photo-\d+\.jpg$/);
  });
});

describe("canSendTurn / sendPayload", () => {
  const file = toFileParts([pending({ filename: "notes.md" })]);

  it("Send is dead only when there is neither text nor a file", () => {
    assert.equal(canSendTurn("", 0), false);
    assert.equal(canSendTurn("   \n ", 0), false);
    assert.equal(canSendTurn("hi", 0), true);
    // The point of the fix: pills alone make Send live.
    assert.equal(canSendTurn("", 1), true);
    assert.equal(canSendTurn("   ", 2), true);
  });

  it("sends attachments with no text as file parts only — no empty text part", () => {
    const payload = sendPayload("   ", file);
    assert.deepEqual(payload, { files: file });
    assert.equal("text" in (payload ?? {}), false);
  });

  it("keeps text and files together when both are present", () => {
    assert.deepEqual(sendPayload("  what is this?  ", file), {
      text: "what is this?",
      files: file,
    });
  });

  it("is text-only when nothing is staged", () => {
    assert.deepEqual(sendPayload(" hello ", []), { text: "hello" });
    assert.deepEqual(sendPayload("hello", undefined), { text: "hello" });
  });

  it("refuses an empty turn", () => {
    assert.equal(sendPayload("", []), null);
    assert.equal(sendPayload("  \t ", undefined), null);
  });

  it("agrees with canSendTurn in both directions", () => {
    for (const [text, count] of [["", 0], ["x", 0], ["", 1], ["  ", 3]] as const) {
      const files = toFileParts(Array.from({ length: count }, (_, i) => pending({ id: `f${i}` })));
      assert.equal(sendPayload(text, files) !== null, canSendTurn(text, count));
    }
  });

  it("copies the staged list so a later clear() can't empty the in-flight turn", () => {
    const staged = [...file];
    const payload = sendPayload("", staged);
    staged.length = 0;
    assert.equal(payload?.files?.length, 1);
  });
});

describe("pickerErrorMessage", () => {
  it("shows a PickerError's own line", () => {
    assert.equal(
      pickerErrorMessage(new PickerError(PHOTO_LIBRARY_UNAVAILABLE_MESSAGE), PHOTO_LIBRARY_FAILED_MESSAGE),
      PHOTO_LIBRARY_UNAVAILABLE_MESSAGE,
    );
  });
  it("never puts a raw exception in front of a person", () => {
    assert.equal(
      pickerErrorMessage(new TypeError("undefined is not an object"), FILES_FAILED_MESSAGE),
      FILES_FAILED_MESSAGE,
    );
    assert.equal(pickerErrorMessage("boom", FILES_FAILED_MESSAGE), FILES_FAILED_MESSAGE);
    assert.equal(pickerErrorMessage(new PickerError(""), FILES_FAILED_MESSAGE), FILES_FAILED_MESSAGE);
  });
});
