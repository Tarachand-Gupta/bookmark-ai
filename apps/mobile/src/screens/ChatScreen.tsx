import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { ChatConversation } from "@bookmark-ai/types";
import { ConversationRow } from "../components/chat/ConversationRow";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useChatConversations } from "../hooks/useChatConversations";
import { useContentWidth } from "../hooks/useContentWidth";
import { ConversationPresentation } from "../navigation/ConversationPresentation";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";
import type { ConversationTarget } from "./ConversationScreen";

/**
 * Ask AI tab — history first, like a messaging app's chat list: past
 * conversations here, and a thread opens FULL-SCREEN over the shell (see
 * ConversationPresentation) so nothing competes with the transcript.
 *
 * This screen owns which conversation is open (`target`): null = the list,
 * `{kind:"new"}` = a fresh thread the server will mint an id for on its first
 * turn, `{kind:"existing"}` = a stored one to hydrate. Closing refreshes the list
 * when the thread reported a change, since a first exchange CREATES the
 * conversation server-side and every turn bumps its `updatedAt`.
 */
export function ChatScreen({ active = true }: { active?: boolean }) {
  const { colors, radius } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  // Tablet widths: header, search field and rows share the centered column.
  const { inset } = useContentWidth();
  const onScroll = useTabBarScroll();
  const history = useChatConversations(active);

  const [target, setTarget] = useState<ConversationTarget | null>(null);
  const [query, setQuery] = useState("");

  // Client-side title filter: the whole list is already in memory (conversation
  // summaries are tiny), so a server round-trip per keystroke would be waste.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history.conversations;
    return history.conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [history.conversations, query]);

  const openNew = useCallback(() => {
    void Haptics.selectionAsync();
    setTarget({ kind: "new" });
  }, []);

  const openExisting = useCallback((conversation: ChatConversation) => {
    setTarget({ kind: "existing", id: conversation.id, title: conversation.title });
  }, []);

  const closeThread = useCallback(
    (changed: boolean) => {
      setTarget(null);
      // The thread created a conversation or bumped one's `updatedAt` — pull the
      // fresh list, silently (the rows are already on screen).
      if (changed) history.revalidate();
    },
    [history],
  );

  const confirmDelete = useCallback(
    (conversation: ChatConversation) => {
      Alert.alert(
        "Delete chat?",
        `"${conversation.title.trim() || "New chat"}" and all of its messages will be removed.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              history.remove(conversation.id).catch((err: unknown) => {
                Alert.alert("Could not delete", err instanceof Error ? err.message : String(err));
              });
            },
          },
        ],
      );
    },
    [history],
  );

  const hasQuery = query.trim().length > 0;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={[styles.largeTitle, { color: colors.foreground }]}>Ask AI</Text>
        <Pressable
          onPress={openNew}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          style={styles.compose}
        >
          <Symbol name="square.and.pencil" size={22} color={colors.foreground} fallback="✎" />
        </Pressable>
      </View>
      {/* Only worth its vertical space once there's history to sift. */}
      {history.conversations.length > 0 && (
        <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.lg }]}>
          <Symbol name="magnifyingglass" size={17} color={colors.mutedForeground} fallback="⌕" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: colors.foreground }]}
          />
          {hasQuery && (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Symbol
                name="xmark.circle.fill"
                size={18}
                color={colors.mutedForeground}
                fallback="✕"
              />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  const empty = history.loading ? (
    <HistorySkeleton />
  ) : history.error !== null && history.conversations.length === 0 ? (
    <LoadFailed message={history.error} onRetry={history.refresh} />
  ) : hasQuery ? (
    <View style={styles.empty}>
      <Symbol name="magnifyingglass" size={26} color={colors.mutedForeground} fallback="⌕" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No matching chats</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Titles come from your first message in each chat.
      </Text>
    </View>
  ) : (
    <FirstRun onStart={openNew} />
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        renderItem={({ item, index }) => (
          <ConversationRow
            conversation={item}
            last={index === filtered.length - 1}
            onOpen={() => openExisting(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        refreshControl={
          <RefreshControl
            refreshing={history.refreshing}
            onRefresh={history.refresh}
            tintColor={colors.mutedForeground}
          />
        }
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: inset }}
      />
      <ConversationPresentation target={target} onClose={closeThread} />
    </View>
  );
}

/** Fixed-height rows so the real list lands without a layout jump (same idea as
 * Home's skeletons). */
function HistorySkeleton() {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.skeletons} accessibilityLabel="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{ height: 46, borderRadius: radius.lg, backgroundColor: colors.muted }}
        />
      ))}
    </View>
  );
}

/** Nothing cached and the fetch failed — pull-to-refresh works too, but an
 * explicit button is the affordance people look for. */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.empty}>
      <Symbol
        name="exclamationmark.triangle"
        size={26}
        color={colors.mutedForeground}
        fallback="!"
      />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Could not load chats</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{message}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={[styles.secondary, { borderColor: colors.border, borderRadius: radius.lg }]}
      >
        <Text style={[styles.secondaryLabel, { color: colors.foreground }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** No history yet: one line on what this is for, and one button into it. */
function FirstRun({ onStart }: { onStart: () => void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.empty}>
      <Symbol name="sparkles" size={30} color={colors.mutedForeground} fallback="✦" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No chats yet</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Ask anything about your bookmarks — searches, counts, summaries, or what&apos;s open right
        now.
      </Text>
      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: colors.primary, borderRadius: radius.lg, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.primaryLabel, { color: colors.primaryForeground }]}>Start a chat</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // paddingTop 8 / paddingHorizontal 20 — the `header` block every other screen
  // uses, so all five large titles share one baseline.
  header: { gap: 12, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  compose: { width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  // letterSpacing: 0 is explicit — see SearchScreen's note on the OTP field leak.
  input: { flex: 1, fontSize: 17, paddingVertical: 11, letterSpacing: 0 },
  skeletons: { gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 64, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
  primary: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 12 },
  primaryLabel: { fontSize: 16, fontWeight: "600" },
  secondary: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryLabel: { fontSize: 15, fontWeight: "600" },
});
