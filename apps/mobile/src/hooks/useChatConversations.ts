import { useCallback } from "react";
import type { ChatConversation } from "@bookmark-ai/types";
import { deleteChatConversation, listChatConversations } from "../api";
import { useCachedResource } from "./useCachedResource";
export interface ChatConversationsState {
  conversations: ChatConversation[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
  revalidate: () => void;
  remove: (id: string) => Promise<void>;
}
export function useChatConversations(active: boolean): ChatConversationsState {
  const resource = useCachedResource("chat-history", listChatConversations, active);
  const remove = useCallback(async (id: string) => {
    if (resource.readOnly || resource.error)
      throw new Error("Reconnect and restore sign-in before deleting a chat.");
    await deleteChatConversation(id);
    resource.replace({ conversations: (resource.data?.conversations ?? []).filter(c => c.id !== id) });
  }, [resource.data, resource.readOnly, resource.error, resource.replace]);
  return { conversations: resource.data?.conversations ?? [], loading: resource.loading,
    refreshing: resource.refreshing, error: resource.error, refresh: resource.refresh,
    revalidate: resource.refresh, remove };
}
