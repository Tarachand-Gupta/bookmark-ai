import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { createBookmark } from "@/lib/api";
import { detectSource } from "@/lib/detect";
import {
  isSaveBookmarkMessage,
  type SaveBookmarkMessage,
  type SaveBookmarkResult,
} from "@/lib/messages";

async function handleSave(
  message: SaveBookmarkMessage,
): Promise<SaveBookmarkResult> {
  try {
    const bookmark = await createBookmark({
      url: message.url,
      title: message.title,
      ...detectSource(),
    });
    return { ok: true, bookmark };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (r: SaveBookmarkResult) => void) => {
      if (!isSaveBookmarkMessage(message)) return;
      void handleSave(message).then(sendResponse);
      return true; // keep the channel open for the async response
    },
  );
});
