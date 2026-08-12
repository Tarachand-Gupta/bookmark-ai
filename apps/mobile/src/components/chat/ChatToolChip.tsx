import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import { toolChipCopy } from "../../lib/chatFormat";
import { Symbol } from "../Symbol";

/** The AI SDK's tool-part lifecycle (see ToolUIPart in `ai`), narrowed to the
 * three things a chip has to show. */
export type ToolChipState = "running" | "done" | "failed";

/** Map a tool part's `state` to what the chip renders. */
export function toolChipState(state: string): ToolChipState {
  if (state === "output-available") return "done";
  if (state === "output-error") return "failed";
  // input-streaming / input-available / approval-requested — still working.
  return "running";
}

/**
 * One agent step, as a compact status chip: "Searching bookmarks…" with a
 * spinner while it runs, a checkmark when its output lands.
 *
 * The web thread renders each tool call as a rich card (result lists, SQL, web
 * hits). On a phone that buries the answer under scaffolding, so mobile shows the
 * step and keeps the answer — with its inline citations — as the payload.
 */
export function ChatToolChip({ partType, state }: { partType: string; state: string }) {
  const { colors, radius } = useAppTheme();
  const copy = toolChipCopy(partType);
  const phase = toolChipState(state);
  const label =
    phase === "failed" ? `${copy.done} — failed` : phase === "done" ? copy.done : copy.running;
  const tint = phase === "failed" ? colors.destructive : colors.mutedForeground;

  return (
    <View
      style={[styles.chip, { backgroundColor: colors.muted, borderRadius: radius.lg }]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {phase === "running" ? (
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      ) : (
        <Symbol
          name={phase === "failed" ? "exclamationmark.triangle" : copy.symbol}
          size={13}
          color={tint}
          fallback={phase === "failed" ? "!" : copy.fallback}
        />
      )}
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      {phase === "done" && (
        <Symbol name="checkmark" size={11} color={colors.mutedForeground} fallback="✓" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  label: { flexShrink: 1, fontSize: 13, fontWeight: "500" },
});
