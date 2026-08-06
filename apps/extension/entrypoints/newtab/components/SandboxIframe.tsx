import { forwardRef, useEffect, useRef } from "react";
import { browser } from "wxt/browser";
import type { NewTabTemplate, NewTabWizardData } from "@bookmark-ai/types";
import { attachBridge } from "../bridge";

/**
 * Belt-and-braces second sandbox (design §4.4, §5.1): even if allow-scripts
 * were somehow widened, connect-src 'none' blocks fetch/XHR/WebSocket exfil.
 * set via setAttribute — `csp` isn't in React's known-attribute folksonomy and
 * relying on unknown-attr passthrough is a footgun.
 */
const IFRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: https:; connect-src 'none';";

/**
 * The agent's HTML, hosted in the one place it is allowed to run (§4.4):
 * `<iframe srcdoc sandbox="allow-scripts">` — an OPAQUE origin. It can run
 * scripts and postMessage to us; it cannot touch cookies, storage, our DOM,
 * or chrome.*. NEVER add allow-same-origin/allow-forms/allow-popups here —
 * that's the entire security model (§5.1).
 */
export const SandboxIframe = forwardRef<
  HTMLIFrameElement,
  {
    template: NewTabTemplate;
    getWizard: () => Promise<NewTabWizardData>;
    /** Out-param: the live bridge handle (for the chat popover's rendered-data
     *  snapshot — §4.8). Parent passes a ref; we fill it on mount. */
    bridgeRef: { current: { getRenderedSnapshot(): Record<string, unknown> } | null };
  }
>(function SandboxIframe({ template, getWizard, bridgeRef }, outerRef) {
  const innerRef = useRef<HTMLIFrameElement | null>(null);

  // Attach the bridge ONCE per mounted iframe; it survives srcdoc swaps
  // (contentWindow persists across srcdoc navigations).
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.setAttribute("csp", IFRAME_CSP);
    const bridge = attachBridge({
      iframe: el,
      getWizard,
      onOpenUrl: (url) => {
        void browser.tabs.create({ url });
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.detach();
      bridgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <iframe
      ref={(el) => {
        innerRef.current = el;
        if (typeof outerRef === "function") outerRef(el);
        else if (outerRef) outerRef.current = el;
      }}
      sandbox="allow-scripts"
      srcDoc={template.html}
      title={template.name}
      className="h-full w-full border-0"
    />
  );
});
