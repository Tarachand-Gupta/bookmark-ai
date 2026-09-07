import { defineContentScript } from "#imports";
import { appPageMatchesFor } from "@/lib/app-origins";
import { keepExtensionMarked } from "@/lib/extension-marker";

/**
 * Presence marker — FIREFOX + SAFARI only (`include`, so it never enters the
 * Chrome manifest). Stamps `data-bookmark-ai-extension="1"` on `<html>` so the
 * web app's "Get the extension" card can tell the extension is installed.
 *
 * Chrome doesn't need this: a page there can message the background directly
 * (`externally_connectable` + `BOOKMARK_AI_PING`), and keeping Chrome on the
 * messaging channel means the fix for a slow service-worker wake ships in the
 * WEB app alone — no store round-trip for the already-published build. Firefox
 * has no such channel at all (see lib/extension-marker.ts), and Safari already
 * pays for a content script here (bridge.content.ts), so both use the marker.
 *
 * Deliberately NOT `run_at: document_start`: stamping the document root before
 * React hydrates is the one moment hydration could drop the attribute (and it
 * makes Next log an "extra attribute from the server" warning). Landing at
 * document_idle costs at most one frame of the card being visible on a first
 * visit — the web app observes the attribute and caches the last-known answer.
 *
 * `matches` is mode-aware (lib/app-origins.ts): WXT evaluates these options at
 * BUILD time with Vite's `import.meta.env.MODE` inlined, so a `production`
 * build injects only on the two prod origins while dev/local builds keep
 * localhost + the dev deployments — the same split as `host_permissions`.
 */
export default defineContentScript({
  matches: [...appPageMatchesFor(import.meta.env.MODE)],
  include: ["firefox", "safari"],
  main() {
    keepExtensionMarked(document);
  },
});
