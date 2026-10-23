"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChatWorkspace } from "@/lib/chat-workspace";
import { apiHeadersForAccount } from "@/lib/api";
import { onExplicitSignOut } from "@/lib/account-private-state";

export function useChatWorkspace(accountId: string) {
  const [workspace] = useState(() => new ChatWorkspace(accountId, () => apiHeadersForAccount(accountId)));
  useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  useEffect(() => {
    workspace.activate();
    try { workspace.hydrate(localStorage); } catch { workspace.hydrate(); /* Restricted storage still permits a new in-memory chat. */ }
    // Expiry/recovery hides the UI but retains the same-account draft. Explicit
    // sign-out removes private persisted content; account-keyed mounting keeps
    // a second account from observing this workspace.
    const unsubscribe = onExplicitSignOut(accountId, () => workspace.clearPrivateData());
    return () => { unsubscribe(); workspace.dispose(); };
  }, [workspace]);
  return workspace;
}
