"use client";

import { ExtensionStoreButton } from "./extension-cta";
import { ExtensionPopupMock } from "./extension-popup-mock";

/**
 * The Sessions view with nothing in it. A session is an extension-only concept,
 * so this both defines the word and shows the button that makes one.
 */
export function SessionsEmpty() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-8 py-10 md:flex-row md:items-center md:gap-12">
      <div className="max-w-sm text-center md:text-left">
        <h2 className="text-xl font-semibold tracking-tight">Save a window of tabs</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          A session is a snapshot of every tab in a browser window. Save one and the window
          closes — the tabs wait here until you restore them, all at once or one at a time.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Open the extension in the window you want to keep, then click{" "}
          <strong className="font-medium text-foreground">Save session &amp; close</strong>.
        </p>
        <div className="mt-5 flex justify-center md:justify-start">
          <ExtensionStoreButton size="sm" />
        </div>
      </div>

      <ExtensionPopupMock className="shrink-0" />
    </section>
  );
}
