import { useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../../context/PreferencesContext";
import {
  formatToolInput,
  summarizeToolOutput,
  toolName,
  toolPhase,
  toolRowCopy,
  type ToolPartLike,
} from "../../lib/chatParts";
import { Symbol } from "../Symbol";
import { chatToolBody } from "./cards/ChatToolBody";

/**
 * One agent step as a row on its own surface: spinner + "Searching bookmarks
 * for “…”" while it runs, its icon + "Found 12 bookmarks" + a check when the
 * output lands, red with the error text when it failed — whether that came as
 * `output-error`/`errorText` or, as the server actually sends it, an
 * `output-available` whose output is `{ error }` (see toolRowCopy). Tapping
 * toggles a disclosure with the input args and a compact output summary — the
 * answer itself, with its inline citations, stays the payload below.
 *
 * The list-shaped tools (searchBookmarks, queryDatabase, listSessions,
 * listLiveTabs) also get a RICH BODY under the header on the same surface —
 * an interactive card the user can filter, fold and page without a model turn
 * (see ./cards). The header and its disclosure are unchanged; the body sits
 * between them, hairline-separated.
 */
export function ChatToolRow({ part }: { part: ToolPartLike }) {
  const { colors, radius } = useAppTheme();
  const [open, setOpen] = useState(false);
  const phase = toolPhase(part.state);
  const copy = toolRowCopy(part);
  const running = phase === "input-streaming" || phase === "input-available";
  const failed = copy.failed;
  const input = formatToolInput(part.input);
  const output =
    phase === "output-available" && !failed ? summarizeToolOutput(toolName(part), part.output) : null;
  const body = chatToolBody(part, failed);

  const toggle = () => {
    void Haptics.selectionAsync();
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      // cosmetic only
    }
    setOpen((value) => !value);
  };

  // The pressed tint rounds its own corners (all four when nothing sits below
  // the header, the top two when a body or the disclosure does) rather than
  // relying on `overflow: hidden` on the card.
  const headerRadius =
    open || body !== null
      ? { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }
      : { borderRadius: radius.lg };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: failed ? colors.destructive : colors.border,
          borderRadius: radius.lg,
        },
      ]}
    >
      <Pressable
        onPress={toggle}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={copy.error ? `${copy.label}. ${copy.error}` : copy.label}
        accessibilityHint="Shows what the tool was asked and what it returned"
        style={({ pressed }) => [
          styles.header,
          headerRadius,
          pressed && { backgroundColor: colors.muted },
        ]}
      >
        <View style={styles.icon}>
          {running ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Symbol
              name={failed ? "exclamationmark.triangle" : copy.symbol}
              size={15}
              color={failed ? colors.destructive : colors.mutedForeground}
              fallback={failed ? "!" : copy.fallback}
            />
          )}
        </View>
        <View style={styles.labels}>
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              { color: failed ? colors.destructive : running ? colors.mutedForeground : colors.foreground },
            ]}
          >
            {copy.label}
          </Text>
          {copy.error !== null && !open && (
            <Text numberOfLines={1} style={[styles.subline, { color: colors.destructive }]}>
              {copy.error}
            </Text>
          )}
        </View>
        {phase === "output-available" && !failed && (
          <Symbol name="checkmark" size={12} color={colors.mutedForeground} fallback="✓" weight="semibold" />
        )}
        <Symbol
          name={open ? "chevron.up" : "chevron.down"}
          size={11}
          color={colors.mutedForeground}
          fallback={open ? "˄" : "˅"}
          weight="semibold"
        />
      </Pressable>

      {body !== null && (
        <View
          style={[
            styles.body,
            { borderTopColor: colors.border },
            !open && { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
          ]}
        >
          {body}
        </View>
      )}

      {open && (
        <View style={[styles.details, { borderTopColor: colors.border }]}>
          {input !== null && <Detail title="Input" text={input} mono />}
          {copy.error !== null && <Detail title="Error" text={copy.error} tint={colors.destructive} />}
          {output !== null && (
            <Detail title="Output" text={output} mono={toolName(part) === "queryDatabase"} />
          )}
          {input === null && copy.error === null && output === null && (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {running ? "Waiting for the tool…" : "Nothing to show for this step."}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function Detail({
  title,
  text,
  mono,
  tint,
}: {
  title: string;
  text: string;
  mono?: boolean;
  tint?: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.detail}>
      <Text style={[styles.detailTitle, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
      <View style={[styles.detailBox, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
        <Text
          selectable
          style={[
            styles.detailText,
            mono && styles.mono,
            { color: tint ?? colors.foreground },
          ]}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

const MONO_FAMILY = Platform.select({ ios: "Menlo", default: "monospace" });

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, alignSelf: "stretch" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  icon: { width: 20, alignItems: "center", justifyContent: "center" },
  labels: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: "500" },
  subline: { fontSize: 12 },
  // `overflow: hidden` so a pressed row's tint and a horizontally scrolling
  // table both clip to the card's rounded bottom corners.
  body: { borderTopWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  details: { gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  detail: { gap: 5 },
  detailTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  detailBox: { paddingHorizontal: 10, paddingVertical: 8 },
  detailText: { fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: MONO_FAMILY, fontSize: 12, lineHeight: 17 },
  empty: { fontSize: 13 },
});
