import { describe, expect, it, vi } from "vitest";
import { bindChatFileDropZone } from "./chat-file-drop-zone";

function fixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { defaultView: window, hidden: false });
  const child = { nodeType: 1 };
  const outside = { nodeType: 1 };
  const root = Object.assign(new EventTarget(), {
    nodeType: 1,
    ownerDocument: document,
    contains: (node: unknown) => node === root || node === child,
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 600 }),
  });
  const change = vi.fn();
  const add = vi.fn();
  const dispose = bindChatFileDropZone(root as unknown as HTMLElement, change, add);
  const file = new File(["image"], "image.png", { type: "image/png" });
  function event(type: string, properties: Record<string, unknown> = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({
      dataTransfer: { types: ["Files"], files: [], dropEffect: "none" },
      clientX: 200,
      clientY: 200,
      relatedTarget: null,
      ...properties,
    }).map(([key, value]) => [key, { value, configurable: true }])));
    return event;
  }
  const enter = () => root.dispatchEvent(event("dragenter"));
  return { root, document, window, child, outside, change, add, dispose, file, event, enter };
}

describe("chat native file drop lifecycle", () => {
  it.each([["text/plain"], ["text/uri-list"], ["text/html", "text/uri-list"]])(
    "ignores text/link drags with types %j", (...types) => {
      const f = fixture();
      const event = f.event("dragenter", { dataTransfer: { types, files: [] } });
      f.root.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(f.change).not.toHaveBeenCalled();
      expect(f.add).not.toHaveBeenCalled();
    },
  );

  it("does not flicker while moving between descendants, including null relatedTarget inside the column", () => {
    const f = fixture();
    f.enter();
    f.root.dispatchEvent(f.event("dragenter"));
    f.root.dispatchEvent(f.event("dragleave", { relatedTarget: f.child }));
    f.root.dispatchEvent(f.event("dragleave"));
    expect(f.change.mock.calls).toEqual([[true]]);
    f.root.dispatchEvent(f.event("dragleave", { relatedTarget: f.outside }));
    expect(f.change.mock.calls).toEqual([[true], [false]]);
  });

  it.each(["dragenter", "dragover"])("clears a missed leave when %s reaches somewhere outside chat", (type) => {
    const f = fixture();
    f.enter();
    f.document.dispatchEvent(f.event(type, { target: f.outside }));
    expect(f.change.mock.calls).toEqual([[true], [false]]);
    expect(f.add).not.toHaveBeenCalled();
  });

  it.each(["drop", "dragend", "pointerdown", "Escape", "blur", "pagehide", "hidden", "leave-window"])(
    "clears a stuck overlay on %s and allows the next drag", (type) => {
      const f = fixture();
      f.enter();
      if (type === "Escape") f.document.dispatchEvent(f.event("keydown", { key: "Escape" }));
      else if (type === "blur" || type === "pagehide") f.window.dispatchEvent(f.event(type));
      else if (type === "hidden") {
        f.document.hidden = true;
        f.document.dispatchEvent(f.event("visibilitychange"));
      } else if (type === "leave-window") {
        f.document.dispatchEvent(f.event("dragleave", { clientX: 0, clientY: 0 }));
      } else f.document.dispatchEvent(f.event(type, { target: f.outside }));
      expect(f.change.mock.calls).toEqual([[true], [false]]);
      expect(f.add).not.toHaveBeenCalled();
      f.enter();
      expect(f.change.mock.calls).toEqual([[true], [false], [true]]);
    },
  );

  it("adds a file once even after document drop capture resets the overlay, and stops composer propagation", () => {
    const f = fixture();
    f.enter();
    const event = f.event("drop", { target: f.child, dataTransfer: { types: ["Files"], files: [f.file] } });
    const stop = vi.spyOn(event, "stopPropagation");
    // The document capture listener runs before the chat root capture listener.
    f.document.dispatchEvent(event);
    f.root.dispatchEvent(event);
    expect(f.change.mock.calls).toEqual([[true], [false]]);
    expect(event.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(f.add).toHaveBeenCalledExactlyOnceWith([f.file]);
  });

  it("resets without adding an empty file drop or a text drop", () => {
    const f = fixture();
    f.enter();
    f.root.dispatchEvent(f.event("drop"));
    f.enter();
    const text = f.event("drop", { dataTransfer: { types: ["text/plain"], files: [] } });
    f.root.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    expect(f.change.mock.calls).toEqual([[true], [false], [true], [false]]);
    expect(f.add).not.toHaveBeenCalled();
  });

  it("recognizes a real dropped file when its types list is empty", () => {
    const f = fixture();
    f.root.dispatchEvent(f.event("drop", { dataTransfer: { types: [], files: [f.file] } }));
    expect(f.add).toHaveBeenCalledExactlyOnceWith([f.file]);
  });

  it("removes native listeners on unmount", () => {
    const f = fixture();
    f.dispose();
    f.enter();
    f.root.dispatchEvent(f.event("drop", { dataTransfer: { types: ["Files"], files: [f.file] } }));
    f.document.dispatchEvent(f.event("pointerdown"));
    f.window.dispatchEvent(f.event("blur"));
    expect(f.change).not.toHaveBeenCalled();
    expect(f.add).not.toHaveBeenCalled();
  });
});
