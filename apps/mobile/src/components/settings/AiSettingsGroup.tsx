import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AI_NOTE_OWN_KEY_INCOMPLETE,
  type AiMode,
  type AiProvider,
  type UserSettings,
} from "@bookmark-ai/types";
import { useAppTheme } from "../../context/PreferencesContext";
import type { AiPlanState } from "../../hooks/useAiPlan";
import { creditsSummary, resetLabel } from "../../lib/aiCredits";
import { SegmentedControl } from "../SegmentedControl";
import { Symbol } from "../Symbol";
import { Group, GroupFootnote, GroupLabel, GroupRow } from "./SettingsGroup";

/** Where keys are added/removed — a web-app flow (Settings → AI); mobile links
 * straight to that section (`?settings=<id>` deep link, see the web's
 * settings-dialog.tsx). */
export const WEB_AI_SETTINGS_URL = "https://bookmark-ai.cloud/app/library?settings=ai";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  google: "Google",
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom endpoint",
};

const MODE_SEGMENTS: { value: AiMode; label: string }[] = [
  { value: "included", label: "Included" },
  { value: "own", label: "Own key" },
];

/**
 * Settings → Ask AI. The weekly credits meter always; then, ONLY when a key is
 * saved, the mode switch (Included free AI | Your own key — a `PUT { aiMode }`
 * that never touches the key) with the contract copy for each mode and the
 * saved-key summary. Without a key the group points at the web app, where keys
 * are added.
 */
export function AiSettingsGroup({ state }: { state: AiPlanState }) {
  const { colors } = useAppTheme();
  const settings = state.settings;

  return (
    <>
      <GroupLabel>Ask AI</GroupLabel>
      <Group>
        {state.loading && settings === null ? (
          <Skeleton />
        ) : settings === null ? (
          <GroupRow
            first
            symbol="exclamationmark.triangle"
            label="Couldn't load AI settings"
            detail="Try again"
            chevron
            onPress={state.reload}
          />
        ) : (
          <>
            <CreditsRow settings={settings} />
            {settings.apiKeySet ? (
              <>
                <ModeRow settings={settings} state={state} />
                <GroupRow
                  symbol="key"
                  label="Saved key"
                  detail={`${PROVIDER_LABEL[settings.provider]} · ••••${settings.apiKeyLast4 ?? ""}`}
                />
                <GroupRow
                  symbol="safari"
                  label="Manage key on the web"
                  chevron
                  onPress={() => void Linking.openURL(WEB_AI_SETTINGS_URL)}
                />
              </>
            ) : (
              <GroupRow
                symbol="key"
                label="Add your own API key"
                detail="on the web"
                chevron
                onPress={() => void Linking.openURL(WEB_AI_SETTINGS_URL)}
              />
            )}
          </>
        )}
      </Group>
      {settings !== null && !settings.apiKeySet && (
        <GroupFootnote>
          Bring your own key for unmetered AI on your provider. Keys are added in the web app
          under Settings → AI; once saved, chat switches to it automatically when the free
          credits run out.
        </GroupFootnote>
      )}
      {state.error !== null && settings !== null && (
        <GroupFootnote>{state.error}</GroupFootnote>
      )}
      {state.error !== null && settings === null && !state.loading && (
        <Text style={[styles.error, { color: colors.destructive }]}>{state.error}</Text>
      )}
    </>
  );
}

/** "Free credits · 312 / 1,000" with a thin meter and the reset day. */
function CreditsRow({ settings }: { settings: UserSettings }) {
  const { colors } = useAppTheme();
  const credits = creditsSummary(settings.aiUsage);
  const ownKey = settings.aiMode === "own";
  return (
    <View style={styles.credits} accessibilityRole="text">
      <View style={styles.creditsHead}>
        <Symbol name="sparkles" size={20} color={colors.mutedForeground} fallback="✦" />
        <Text style={[styles.creditsLabel, { color: colors.foreground }]}>Free credits</Text>
        {credits !== null && (
          <Text style={[styles.creditsValue, { color: colors.mutedForeground }]}>
            {credits.used.toLocaleString()} / {credits.limit.toLocaleString()}
          </Text>
        )}
      </View>
      {credits !== null && (
        <View style={[styles.track, { backgroundColor: colors.muted }]}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: ownKey ? colors.mutedForeground : colors.foreground,
                width: `${Math.round(credits.fraction * 100)}%`,
                opacity: ownKey ? 0.5 : 1,
              },
            ]}
          />
        </View>
      )}
      <Text style={[styles.creditsMeta, { color: colors.mutedForeground }]}>
        {credits === null
          ? "Included free AI · 2,000 credits a week"
          : ownKey
            ? `${credits.remaining.toLocaleString()} left this week · not metered while chat runs on your key`
            : `${credits.remaining.toLocaleString()} left this week · ${resetLabel(settings.aiUsage?.resetsAt)}`}
      </Text>
    </View>
  );
}

/** The §1 mode switch — shown only when a key is saved. */
function ModeRow({ settings, state }: { settings: UserSettings; state: AiPlanState }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.mode, { borderTopColor: colors.border }]}>
      <View style={styles.modeHead}>
        <Text style={[styles.modeLabel, { color: colors.foreground }]}>Chat runs on</Text>
        {state.saving ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <SegmentedControl segments={MODE_SEGMENTS} value={settings.aiMode} onChange={state.setAiMode} />
        )}
      </View>
      <Text style={[styles.modeCopy, { color: colors.mutedForeground }]}>
        {settings.aiMode === "own"
          ? "Chat runs on your key. Nothing is metered against the free credits."
          : "Your key stays saved. When the free credits run out this week, chat automatically switches to your key."}
      </Text>
      {/* A key without a model can't answer anything yet (GET /api/settings
          `ownKeyReady`); choosing one is a web-app flow. */}
      {settings.ownKeyReady === false && (
        <View style={styles.modeWarning}>
          <Symbol name="exclamationmark.circle" size={14} color={colors.foreground} fallback="!" />
          <Text style={[styles.modeCopy, { color: colors.foreground, flex: 1 }]}>
            {AI_NOTE_OWN_KEY_INCOMPLETE}
          </Text>
        </View>
      )}
      {state.saveError !== null && (
        <Pressable onPress={() => state.setAiMode(settings.aiMode === "own" ? "included" : "own")} accessibilityRole="button">
          <Text style={[styles.modeError, { color: colors.destructive }]}>
            Couldn't switch: {state.saveError}. Tap to retry.
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Skeleton() {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading">
      <View style={[styles.bone, { width: "55%", backgroundColor: colors.muted, borderRadius: radius.sm }]} />
      <View style={[styles.bone, { width: "100%", height: 4, backgroundColor: colors.muted, borderRadius: 2 }]} />
      <View style={[styles.bone, { width: "70%", backgroundColor: colors.muted, borderRadius: radius.sm }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  credits: { gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  creditsHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  creditsLabel: { flex: 1, fontSize: 17 },
  creditsValue: { fontSize: 15, fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
  creditsMeta: { fontSize: 13, lineHeight: 18 },
  mode: { gap: 8, paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  modeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  modeLabel: { fontSize: 17 },
  modeCopy: { fontSize: 13, lineHeight: 18 },
  modeWarning: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  modeError: { fontSize: 13, lineHeight: 18 },
  skeleton: { gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  bone: { height: 14 },
  error: { fontSize: 13, lineHeight: 18, marginTop: 10, marginHorizontal: 4 },
});
