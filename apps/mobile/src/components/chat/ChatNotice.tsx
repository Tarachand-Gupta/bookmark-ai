import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import type { FreeLimitInfo } from "../../hooks/useAiChat";
import { Symbol } from "../Symbol";

/**
 * The three ways a turn can end without an answer, as inline cards in the
 * transcript (never an alert — the thread has to keep its context):
 *
 *  - 402 `free-limit-exceeded`: the shared AI's WEEKLY token budget is spent.
 *    Configuring a personal API key is a web-app flow (Settings → AI), so mobile
 *    explains and points there instead of pretending it can fix it here.
 *  - 429: the per-account DAILY chat quota. Nothing to do but wait.
 *  - anything else (network drop, stream error, 5xx): retryable, and the retry
 *    re-runs the same turn via `regenerate()`.
 */
export function ChatLimitNotice({ info }: { info: FreeLimitInfo }) {
  const { colors, radius } = useAppTheme();
  const used = info.usedTokens;
  const cap = info.limitTokens;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <View style={styles.titleRow}>
        <Symbol name="sparkles" size={16} color={colors.foreground} fallback="✦" />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Weekly free AI limit reached
        </Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {used !== undefined && cap !== undefined
          ? `You've used all ${formatTokens(cap)} of this week's shared AI tokens (${formatTokens(used)} spent). The budget resets weekly — or add your own API key in the web app under Settings → AI for unmetered chat.`
          : "This week's shared AI budget is used up. It resets weekly — or add your own API key in the web app under Settings → AI for unmetered chat."}
      </Text>
    </View>
  );
}

export function ChatQuotaNotice({ message }: { message: string }) {
  const { colors, radius } = useAppTheme();
  // The API answers 429 for two different things (see useAiChat): a spent daily
  // quota, and the coarse IP rate limiter. "Try again tomorrow" would be wrong
  // advice for the second one — a few seconds is enough.
  const rateLimited = /too many requests/i.test(message);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <View style={styles.titleRow}>
        <Symbol name="exclamationmark.triangle" size={16} color={colors.foreground} fallback="!" />
        <Text style={[styles.title, { color: colors.foreground }]}>
          {rateLimited ? "Too many requests" : "Daily chat limit reached"}
        </Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {rateLimited
          ? "You're sending requests faster than the server allows. Wait a moment and ask again."
          : message || "Try again tomorrow."}
      </Text>
    </View>
  );
}

export function ChatErrorNotice({ onRetry }: { onRetry: () => void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        styles.errorCard,
        { borderColor: colors.destructive, borderRadius: radius.lg },
      ]}
    >
      <Text style={[styles.body, styles.errorText, { color: colors.destructive }]}>
        Something went wrong answering that.
      </Text>
      <Pressable
        onPress={onRetry}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={[styles.retry, { borderColor: colors.border, borderRadius: radius.md }]}
      >
        <Symbol name="arrow.clockwise" size={14} color={colors.foreground} fallback="↻" />
        <Text style={[styles.retryLabel, { color: colors.foreground }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

/** 1_250_000 → "1.3M", 40_000 → "40K" — a budget reads as a size, not a number. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    marginHorizontal: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  errorText: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20 },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryLabel: { fontSize: 14, fontWeight: "600" },
});
