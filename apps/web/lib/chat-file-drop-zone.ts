/** Bind native file dragging to the stable chat column, not its transient overlay. */
export function bindChatFileDropZone(
  root: HTMLElement,
  onDraggingChange: (dragging: boolean) => void,
  onFiles: (files: File[]) => void,
): () => void {
  const document = root.ownerDocument;
  const window = document.defaultView;
  let dragging = false;
  const cleanups: (() => void)[] = [];

  const setDragging = (next: boolean) => {
    if (dragging === next) return;
    dragging = next;
    onDraggingChange(next);
  };
  const reset = () => setDragging(false);
  const contains = (target: EventTarget | null) =>
    !!target && typeof (target as Node).nodeType === "number" && root.contains(target as Node);
  const hasFiles = (transfer: DataTransfer | null) =>
    !!transfer && (Array.from(transfer.types ?? []).includes("Files") || transfer.files.length > 0);
  const insideBounds = (event: DragEvent) => {
    const bounds = root.getBoundingClientRect();
    return event.clientX >= bounds.left && event.clientX < bounds.right &&
      event.clientY >= bounds.top && event.clientY < bounds.bottom;
  };
  const listen = (target: EventTarget, type: string, handler: (event: Event) => void) => {
    const options = { capture: true };
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  const onDrag = (event: Event) => {
    const drag = event as DragEvent;
    if (!hasFiles(drag.dataTransfer)) {
      reset();
      return;
    }
    drag.preventDefault();
    if (drag.dataTransfer) drag.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  listen(root, "dragenter", onDrag);
  listen(root, "dragover", onDrag);
  listen(root, "dragleave", (event) => {
    const drag = event as DragEvent;
    // Native dragleave can have a null relatedTarget even between descendants.
    // Check the whole column and pointer position rather than the overlay node.
    if (contains(drag.relatedTarget) || (!drag.relatedTarget && insideBounds(drag))) return;
    reset();
  });
  listen(root, "drop", (event) => {
    const drag = event as DragEvent;
    reset();
    if (!hasFiles(drag.dataTransfer)) return;
    drag.preventDefault();
    // Capture before the composer sees this event, so it cannot add files twice.
    drag.stopPropagation();
    const files = Array.from(drag.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  });

  for (const type of ["dragenter", "dragover"]) {
    listen(document, type, (event) => {
      if (!contains(event.target)) reset();
    });
  }
  listen(document, "dragleave", (event) => {
    const drag = event as DragEvent;
    if (!drag.relatedTarget && !insideBounds(drag)) reset();
  });
  for (const type of ["drop", "dragend", "pointerdown"]) listen(document, type, reset);
  listen(document, "keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") reset();
  });
  listen(document, "visibilitychange", () => {
    if (document.hidden) reset();
  });
  if (window) {
    listen(window, "blur", reset);
    listen(window, "pagehide", reset);
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
