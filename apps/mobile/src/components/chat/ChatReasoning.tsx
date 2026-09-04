import { useEffect, useRef, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../../context/PreferencesContext";
import { thoughtLabel } from "../../lib/chatParts";
import { Symbol } from "../Symbol";
import { ShimmerText } from "./ShimmerText";

/**
 * Client-side timing of a thought. UI parts carry no timestamps, so the
 * disclosure's "Thought for N s" is measured here: from the first render that
 * sees the block streaming to the first that sees it finished. Module-level (not
 * component state) so a FlatList recycle or a re-key mid-stream can't lose it.
 * Persisted conversations never enter it and read "Thoughts".
 */
const timings = new Map<string, { start: number; end?: number }>();

function observe(id: string, streaming: boolean): number | null {
  const entry = timings.get(id);
  if (streaming) {
    if (!entry) timings.set(id, { start: Date.now() });
    return null;
  }
  if (entry && entry.end === undefined) entry.end = Date.now();
  return entry && entry.end !== undefined ? (entry.end - entry.start) / 1000 : null;
}

/** Gemini's thoughts arrive with markdown emphasis; a disclosure reads better
 * without the raw asterisks. Anything else stays as written. */
function plainThought(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The reasoning disclosure: "Thinking" (shimmering, auto-expanded) while the
 * model streams its thoughts, collapsing to "Thought for N s" the moment the
 * thought ends; a chevron/tap re-opens it. Persisted parts render collapsed.
 */
export function ChatReasoning({
  id,
  text,
  streaming,
}: {
  /** Stable per block (see assistantBlocks) — the timing key. */
  id: string;
  text: string;
  streaming: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const seconds = observe(id, streaming);
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (wasStreaming.current !== streaming) {
      animateLayout();
      // Thinking ended → fold away; a late-starting thought → unfold.
      setOpen(streaming);
      wasStreaming.current = streaming;
    }
  }, [streaming]);

  const label = thoughtLabel(streaming, seconds);
  const body = plainThought(text);

  const toggle = () => {
    void Haptics.selectionAsync();
    animateLayout();
    setOpen((value) => !value);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}. ${open ? "Collapse" : "Expand"} the model's thoughts`}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Symbol name="brain" size={14} color={colors.mutedForeground} fallback="◌" />
        {streaming ? (
          <ShimmerText style={styles.label} color={colors.mutedForeground} highlight={colors.foreground}>
            {label}
          </ShimmerText>
        ) : (
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        )}
        <Symbol
          name={open ? "chevron.up" : "chevron.down"}
          size={11}
          color={colors.mutedForeground}
          fallback={open ? "˄" : "˅"}
          weight="semibold"
        />
      </Pressable>
      {open && (
        <View
          style={[
            styles.body,
            { borderLeftColor: colors.border, borderRadius: radius.sm },
          ]}
        >
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            {body || (streaming ? "…" : "")}
          </Text>
        </View>
      )}
    </View>
  );
}

function animateLayout() {
  try {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  } catch {
    // Layout animation is a nicety; never let it break a render.
  }
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  pressed: { opacity: 0.55 },
  label: { fontSize: 14, fontWeight: "500" },
  body: { marginLeft: 6, paddingLeft: 12, borderLeftWidth: 2 },
  text: { fontSize: 14, lineHeight: 20 },
});
