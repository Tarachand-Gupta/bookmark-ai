import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import type { FreeLimitInfo } from "../../hooks/useAiChat";
import { tokensToCredits } from "../../lib/aiCredits";
import { Symbol } from "../Symbol";

/**
 * The ways a turn can end without an answer, as inline cards in the transcript
 * (never an alert — the thread has to keep its context):
 *
 *  - 402 `free-limit-exceeded`: the shared AI's WEEKLY credits are spent AND no
 *    personal key is saved — with a key, the server switches to it by itself
 *    (`X-Ai-Source: own-fallback`, see ChatSourceNote) and this card never
 *    appears. Adding a key is a web-app flow (Settings → AI), so mobile explains
 *    the switch and points there.
 *  - 429: the per-account DAILY chat quota. Nothing to do but wait.
 *  - 413/415: the server refused the attachments (its own re-check of the
 *    allowlist/caps the client already applies).
 *  - anything else (network drop, stream error, 5xx): retryable, and the retry
 *    re-runs the same turn via `regenerate()`.
 */
export function ChatLimitNotice({ info }: { info: FreeLimitInfo }) {
  const { colors, radius } = useAppTheme();
  const cap = info.limitTokens !== undefined ? tokensToCredits(info.limitTokens) : null;
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
          Free credits used up for this week
        </Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {cap !== null
          ? `You've used all ${cap.toLocaleString()} of this week's free AI credits. They reset Monday.`
          : "This week's free AI credits are used up. They reset Monday."}{" "}
        Add your own API key in the web app under Settings → AI and chat switches to it
        automatically whenever the free credits run out — unmetered, on your provider.
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

export function ChatRejectedNotice({ message }: { message: string }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <View style={styles.titleRow}>
        <Symbol name="paperclip" size={16} color={colors.foreground} fallback="⊕" />
        <Text style={[styles.title, { color: colors.foreground }]}>Attachments not sent</Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{message}</Text>
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
        style={({ pressed }) => [
          styles.retry,
          { borderColor: colors.border, borderRadius: radius.md },
          pressed && { backgroundColor: colors.muted },
        ]}
      >
        <Symbol name="arrow.clockwise" size={14} color={colors.foreground} fallback="↻" />
        <Text style={[styles.retryLabel, { color: colors.foreground }]}>Retry</Text>
      </Pressable>
    </View>
  );
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
