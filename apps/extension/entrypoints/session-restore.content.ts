import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { appPageMatchesFor } from "@/lib/app-origins";
import { connectSessionRestorePage } from "@/lib/session-restore-bridge";

export default defineContentScript({
  matches: [...appPageMatchesFor(import.meta.env.MODE)],
  include: ["safari", "firefox"],
  runAt: "document_start",
  main(ctx) {
    const disconnect = connectSessionRestorePage(window, message => browser.runtime.sendMessage(message));
    ctx.onInvalidated(disconnect);
  },
});
