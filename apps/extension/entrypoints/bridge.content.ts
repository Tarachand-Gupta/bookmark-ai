import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { isAllowedBridgePath } from "@/lib/bridge-guard";
import { fetchWithTimeout } from "@/lib/net";
import {
  isBridgeFetchMessage,
  isBridgeMeMessage,
  type BridgeFetchMessage,
  type BridgeFetchResult,
  type BridgeMeResult,
} from "@/lib/messages";

/**
 * Path D session bridge — SAFARI ONLY (`include: ["safari"]`, so it never enters
 * the Chrome/Firefox manifests). Runs in an open Bookmark AI tab, i.e. the PAGE
 * context, whose same-origin `fetch(..., {credentials:'include'})` DOES carry the
 * Clerk session cookie — unlike the Safari extension's own network context, which
 * this browser fully partitions from the cookie jar. The background messages this
 * to resolve identity (BRIDGE_ME) and to make authenticated API writes
 * (BRIDGE_FETCH). It NEVER touches page globals, evals nothing, and only proxies
 * whitelisted relative /api/ paths.
 */

const NULL_BODY: BridgeMeResult = { ok: false, signedIn: false, name: null, email: null };

/*
 * Both bridge fetches are BOUNDED (lib/net.ts). The background awaits
 * `tabs.sendMessage` for the reply; a page-context fetch that never settles
 * would leave that message unanswered, and `bridgeGetUser`/`bridgeFetch` — and
 * with them Safari's popup gate and every bridged write — hang behind it. The
 * same network-switch stall that wedged the Chrome worker (2026-09-02) applies
 * to this context unchanged; the timeout here is what keeps Safari at parity.
 */

async function handleMe(): Promise<BridgeMeResult> {
  try {
    const res = await fetchWithTimeout("/api/me", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 401) return { ok: true, signedIn: false, name: null, email: null };
    if (!res.ok) return NULL_BODY;
    const body = (await res.json()) as { name?: string | null; email?: string | null };
    return { ok: true, signedIn: true, name: body.name ?? null, email: body.email ?? null };
  } catch {
    return NULL_BODY;
  }
}

async function handleFetch(message: BridgeFetchMessage): Promise<BridgeFetchResult> {
  // Defense in depth: only relative /api/ paths, never an absolute/foreign URL.
  if (!isAllowedBridgePath(message.path)) return { ok: false, status: 0 };
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    const init: RequestInit = {
      method: message.method ?? "GET",
      credentials: "include",
      headers,
    };
    if (message.bodyJson !== undefined) {
      headers["content-type"] = "application/json";
      init.body = message.bodyJson;
    }
    const res = await fetchWithTimeout(message.path, init);
    const text = await res.text();
    return { ok: res.ok, status: res.status, bodyJson: text || undefined };
  } catch {
    return { ok: false, status: 0 };
  }
}

export default defineContentScript({
  matches: ["https://bookmark-ai.cloud/*", "https://www.bookmark-ai.cloud/*"],
  include: ["safari"],
  main() {
    // Double-injection guard: the background re-injects this file into tabs
    // whose bridge doesn't answer (scripting.executeScript). Within one install
    // the isolated world is shared, so a second injection must not add a second
    // listener (a duplicated BRIDGE_FETCH would execute writes twice). After a
    // REINSTALL the new install gets a fresh isolated world, so the orphan's
    // flag is invisible and injection proceeds — exactly what we want.
    const w = window as unknown as { __bookmarkAiBridge?: boolean };
    if (w.__bookmarkAiBridge) return;
    w.__bookmarkAiBridge = true;

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Only our own extension's BACKGROUND may drive the bridge. A web page
      // cannot reach runtime.onMessage at all; still, be explicit: a message
      // originating from any tab context carries sender.tab (background/popup do
      // not), and a foreign extension id is rejected outright.
      if (sender.tab) return undefined;
      if (sender.id && sender.id !== browser.runtime.id) return undefined;

      if (isBridgeMeMessage(message)) {
        void handleMe().then(sendResponse);
        return true;
      }
      if (isBridgeFetchMessage(message)) {
        void handleFetch(message).then(sendResponse);
        return true;
      }
      return undefined;
    });
  },
});
