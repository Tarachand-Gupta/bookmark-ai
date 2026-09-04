import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches a synchronous throw from the ClerkProvider subtree — most importantly
 * `@clerk/chrome-extension`'s `createClerkClient()`, whose `validateManifest()`
 * throws inside ClerkProvider's effect on any manifest that lacks a top-level
 * `host_permissions` key while syncHost is set (MV2 = Firefox/Safari). React
 * unmounts the whole root on an uncaught render/effect error, which is what
 * blanked the popup; this boundary renders `fallback` instead so a Clerk init
 * failure can never blank the popup again.
 */
export class ClerkBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Bookmark AI] Clerk failed to initialize; showing fallback popup.", error, info);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
