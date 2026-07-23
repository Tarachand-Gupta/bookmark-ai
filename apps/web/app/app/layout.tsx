import { Suspense } from "react";
import { AppChatDock } from "@/components/library/app-chat-dock";

/**
 * Layout for the signed-in app segment (/app). Mounting the Ask AI dock HERE —
 * a sibling of the page, not inside it — is what makes the chat persist: Next
 * keeps a layout and its client children alive across every navigation that
 * stays within the segment (and all library navigation is shallow ?param state
 * on this one route), so the docked conversation is never remounted while the
 * left side changes. The dock reads its own open/close state from the URL.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* useSearchParams (inside the dock) needs a Suspense boundary. */}
      <Suspense>
        <AppChatDock />
      </Suspense>
    </>
  );
}
