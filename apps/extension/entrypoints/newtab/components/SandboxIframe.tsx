import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import type { NewTabTemplate, NewTabWizardData } from "@bookmark-ai/types";
import { attachBridge, type BridgeHandle } from "../bridge";

/**
 * The agent's HTML, hosted in the one place Chrome allows it to run (design
 * §4.4/§5.1 after the srcdoc dead end — see newtab-frame.html's header):
 * srcdoc iframes on an extension page inherit the extension_pages CSP
 * (script-src 'self'), which hard-blocks the template's inline <script> —
 * Chrome removed the `iframe csp` attribute, so there is no in-page opt-out.
 * The sanctioned primitive is the MANIFEST-sandboxed page
 * (public/newtab-frame.html): its `content_security_policy.sandbox` permits
 * 'unsafe-inline' scripts under `sandbox allow-scripts` — script execution
 * with an OPAQUE origin (postMessage-only; no chrome APIs, network, storage).
 *
 * Flow per template/rewrite: navigate the frame (?n= cache-bust forces a real
 * reload — document.write consumes the frame's own listener) → the frame
 * announces {type:"frame:ready"} → we post {type:"newtab:render", html}.
 * The frame renders ours ONLY (source-guard + namespaced type + size cap).
 *
 * The bridge contract is unchanged: template messages still go
 * frame → THIS page (window.parent) with origin "null", and this page's
 * attachBridge validates + answers them.
 */
const FRAME_PATH = "/newtab-frame.html" as const;

export function SandboxIframe({
  template,
  getWizard,
  bridgeRef,
}: {
  template: NewTabTemplate;
  getWizard: () => Promise<NewTabWizardData>;
  /** Out-param: the live bridge handle (for the chat popover's rendered-data
   *  snapshot — §4.8). Parent passes a ref; we fill it on mount. */
  bridgeRef: { current: BridgeHandle | null };
}) {
  const [el, setEl] = useState<HTMLIFrameElement | null>(null);
  const navCount = useRef(0);
  const pendingHtml = useRef<string | null>(null);

  // Bridge attaches ONCE per mounted iframe element; contentWindow persists
  // across navigations, so the bridge's event.source guard still matches.
  useEffect(() => {
    if (!el) return;
    const bridge = attachBridge({
      iframe: el,
      getWizard,
      onOpenUrl: (url) => void browser.tabs.create({ url }),
    });
    bridgeRef.current = bridge;

    // Frame handshake: navigation swaps the frame's document (and its own
    // listener with it), so template HTML is (re)sent on EVERY frame:ready.
    const onFrameMessage = (event: MessageEvent) => {
      if (event.source !== el.contentWindow) return;
      const d = event.data as { type?: unknown } | null;
      if (d?.type !== "frame:ready") return;
      const html = pendingHtml.current;
      if (html !== null) {
        el.contentWindow?.postMessage({ type: "newtab:render", html }, "*");
        pendingHtml.current = null;
      }
    };
    window.addEventListener("message", onFrameMessage);

    return () => {
      window.removeEventListener("message", onFrameMessage);
      bridge.detach();
      bridgeRef.current = null;
    };
  }, [el, getWizard, bridgeRef]);

  // Template change → queue the html + hard-navigate the manifest-sandboxed
  // frame (a query-busted URL guarantees a real navigation; a fragment-only
  // change may not reload, and the frame's own listener lives in the old doc).
  useEffect(() => {
    if (!el) return;
    // getURL(path) — leading slash matches WXT's PublicPath typing; the
    // query-busted URL guarantees a real navigation (a fragment-only change
    // may not reload, and the frame's own listener lives in the old doc).
    pendingHtml.current = template.html;
    navCount.current += 1;
    el.src = `${browser.runtime.getURL(FRAME_PATH)}?n=${navCount.current}`;
    el.setAttribute("sandbox", "allow-scripts");
  }, [el, template.id, template.html, template.updatedAt]);

  return <iframe ref={setEl} title={template.name} className="h-full w-full border-0" />;
}
