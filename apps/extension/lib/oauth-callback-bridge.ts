const RESULT_EVENT = "bookmark-extension-authorization";
const READY_EVENT = "bookmark-extension-authorization-ready";
type Result = "complete" | "failed" | "unavailable";

/** Retry only a harmless wake/readiness message. The code is sent once below. */
export async function waitForOAuthCallbackBackground(ready: () => Promise<unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        Promise.resolve().then(ready),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Background readiness timed out")), 1500);
        }),
      ]);
      if (reply && typeof reply === "object") {
        if ((reply as { ok?: unknown }).ok === true) return true;
        if ((reply as { ok?: unknown }).ok === false) return false;
      }
    } catch {
      // No callback URL/code/state was sent, so a cold port can be probed again.
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return false;
}

/** Replay display status when the hosted page hydrates after the content script.
 * Page events never trigger another exchange and carry no authorization data. */
export function connectOAuthCallbackPage(
  target: EventTarget,
  ready: () => Promise<unknown>,
  send: () => Promise<unknown>,
  scrub: () => void,
  report: (stage: Result | "received" | "ready") => void,
): void {
  let result: Result | null = null;
  const publish = () => {
    if (result) target.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: result }));
  };
  target.addEventListener(READY_EVENT, publish);
  report("received");
  void waitForOAuthCallbackBackground(ready).then(async accepted => {
    if (!accepted) {
      result = "unavailable";
      return;
    }
    report("ready");
    return Promise.resolve().then(send).then(
      (reply) => {
        result = reply && typeof reply === "object" && (reply as { ok?: unknown }).ok === true
          ? "complete" : "failed";
      },
      () => { result = "unavailable"; },
    );
  }).then(() => {
    report(result!);
    // Clear the browser URL only after the background has read the bound URL.
    // A transport failure is uncertain, so do not retry a single-use code.
    try { scrub(); } finally { publish(); }
  });
}
