import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { ATTACHMENTS_TOO_MANY_MESSAGE } from "@bookmark-ai/types";
import { pickDocuments, pickImages, type PickOutcome } from "../lib/attachmentPickers";
import {
  FILES_FAILED_MESSAGE,
  PHOTO_LIBRARY_FAILED_MESSAGE,
  acceptAttachments,
  pickerErrorMessage,
  remainingSlots,
  type PendingAttachment,
} from "../lib/chatAttachments";

export interface ChatAttachmentsState {
  /** Files staged for the next send, in pick order. */
  items: PendingAttachment[];
  /** The latest rejection (contract copy) or picker failure; auto-clears. */
  error: string | null;
  /** A picker is open or an image is being encoded — the clip shows a spinner. */
  busy: boolean;
  pickPhotos: () => void;
  pickFiles: () => void;
  remove: (id: string) => void;
  /** Drop everything — called right after a send hands the parts to the chat. */
  clear: () => void;
  dismissError: () => void;
}

/** How long a rejection line stays up before it clears itself. */
const ERROR_TTL_MS = 6_000;

/**
 * The composer's attachment state: what's staged, what was just refused, and
 * the two pickers. Policy (allowlist, per-file and per-message caps) is the
 * shared contract, enforced in src/lib/chatAttachments + attachmentPickers; this
 * hook only sequences it and turns the outcome into UI state.
 */
export function useChatAttachments(): ChatAttachmentsState {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Refs so the async pick path reads CURRENT state after the await.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const busyRef = useRef(false);

  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(() => setError(null), ERROR_TTL_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const admit = useCallback((outcome: PickOutcome) => {
    const { accepted, rejected } = acceptAttachments(itemsRef.current, outcome.attachments);
    if (accepted.length > 0) {
      setItems((prev) => [...prev, ...accepted]);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const reason = rejected ?? outcome.rejected;
    setError(reason);
    if (reason !== null) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  const run = useCallback(
    async (pick: (maxCount: number) => Promise<PickOutcome>, failure: string) => {
      if (busyRef.current) return;
      const slots = remainingSlots(itemsRef.current);
      if (slots === 0) {
        setError(ATTACHMENTS_TOO_MANY_MESSAGE);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        admit(await pick(slots));
      } catch (err) {
        console.warn(`[chat] attachment pick failed: ${(err as Error).message}`);
        // A PickerError already carries the line to show; anything else is
        // unexpected and gets this picker's generic copy.
        setError(pickerErrorMessage(err, failure));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [admit],
  );

  const pickPhotos = useCallback(() => {
    void run(pickImages, PHOTO_LIBRARY_FAILED_MESSAGE);
  }, [run]);
  const pickFiles = useCallback(() => {
    void run(pickDocuments, FILES_FAILED_MESSAGE);
  }, [run]);
  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);
  const clear = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);
  const dismissError = useCallback(() => setError(null), []);

  return { items, error, busy, pickPhotos, pickFiles, remove, clear, dismissError };
}
