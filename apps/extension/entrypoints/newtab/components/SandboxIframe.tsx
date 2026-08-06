import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { NewTabTemplate, NewTabWizardData } from "@bookmark-ai/types";
import { attachBridge, type BridgeHandle } from "../bridge";

/**
 * Belt-and-braces second sandbox (design §4.4, §5.1): even if allow-scripts
 * were somehow widened, connect-src 'none' blocks fetch/XHR/WebSocket exfil.
 */
const IFRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: https:; connect-src 'none';";

/**
 * The agent's HTML, hosted in the one place it is allowed to run (§4.4):
 * `<iframe srcdoc sandbox="allow-scripts">` — an OPAQUE origin. It can run
 * scripts and postMessage to us; it cannot touch cookies, storage, our DOM,
 * or chrome.*. NEVER add allow-same-origin/allow-forms/allow-popups here —
 * that's the entire security model (§5.1).
 *
 * The attributes are set IMPERATIVELY, on the raw element, before srcdoc is
 * ever assigned: a srcdoc document inherits the PARENT page's CSP unless the
 * iframe's own `csp` attribute is already present at document-parse time, and
 * a React prop/effect can apply too late (the extension page's own CSP —
 * extension_pages `script-src 'self'` — would then block the template's inline
 * <script> entirely, silently leaving the skeleton "Loading…" forever).
 */
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

  // Bridge attaches ONCE per mounted iframe element; contentWindow — and so
  // the listener's event.source guard — persists across srcdoc swaps.
  useEffect(() => {
    if (!el) return;
    const bridge = attachBridge({ iframe: el, getWizard, onOpenUrl: (url) => void browser.tabs.create({ url }) });
    bridgeRef.current = bridge;
    return () => {
      bridge.detach();
      bridgeRef.current = null;
    };
  }, [el, getWizard, bridgeRef]);

  // Attribute ordering IS the bug-free path: sandbox → csp → srcdoc, so the
  // document that parses never sees a moment without its sandbox + policy.
  useEffect(() => {
    if (!el) return;
    el.setAttribute("sandbox", "allow-scripts");
    el.setAttribute("csp", IFRAME_CSP);
    el.setAttribute("srcdoc", template.html);
  }, [el, template.html]);

  return <iframe ref={setEl} title={template.name} className="h-full w-full border-0" />;
}
