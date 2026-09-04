import { Component, type ErrorInfo, type ReactNode } from "react";
import { diag } from "@/lib/diag";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Last line of defense for the popup: React unmounts the WHOLE root on an
 * uncaught render/effect error, which blanks the popup with no explanation.
 * This boundary renders `fallback` instead, so whatever throws, the user still
 * gets a working link into the web app.
 *
 * History: this used to exist specifically for `@clerk/chrome-extension`'s
 * `<ClerkProvider>`, whose `validateManifest()` threw inside its effect on
 * Firefox (MV2 normalization strips `host_permissions` from
 * `runtime.getManifest()`). The popup no longer mounts a Clerk client at all
 * (see main.tsx), so today this is a generic guard — kept because "a crash
 * blanks the popup" is a failure mode worth ruling out permanently.
 */
export class PopupErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Bookmark AI] popup crashed; showing fallback.", error, info);
    // Breadcrumb in the dev log too: a Firefox/Safari popup has no inspectable
    // console in the normal test loop, and a fallback on screen tells nobody
    // WHAT threw. Name + message only — never a token/cookie.
    diag("popup", "render error caught", {
      name: error?.name ?? "Error",
      message: String(error?.message ?? error).slice(0, 300),
      browser: import.meta.env.BROWSER,
    });
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
