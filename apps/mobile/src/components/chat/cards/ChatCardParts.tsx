import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { ToolPageMeta } from "@bookmark-ai/types";
import { useAppTheme } from "../../../context/PreferencesContext";
import {
  describePageRange,
  faviconInitial,
  isRenderableFavicon,
  pageFooterVisible,
  showMoreLabel,
} from "../../../lib/chatCards";
import { openWebPage } from "../../../lib/links";
import { Symbol } from "../../Symbol";

/**
 * Shared building blocks for the chat's tool cards (live tabs, bookmark hits,
 * SQL tables, sessions) — the mobile counterpart of the web's
 * chat-card-parts.tsx. Every list-shaped result gets the same toolbar filter,
 * the same "Show N more" control and the same page footer, so the four cards
 * read as one family.
 */

export const MONO_FAMILY = Platform.select({ ios: "Menlo", default: "monospace" });

/** Open a row's link in the in-app browser sheet, with the chat's tap haptic. */
export function openCardLink(url: string): void {
  void Haptics.selectionAsync();
  openWebPage(url);
}

/** The card's header strip: a live filter box on the left, totals on the right. */
export function FilterField({
  query,
  onQuery,
  placeholder,
  summary,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  summary: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
      <View style={[styles.field, { backgroundColor: colors.muted, borderRadius: radius.md }]}>
        <Symbol name="magnifyingglass" size={13} color={colors.mutedForeground} fallback="⌕" />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          clearButtonMode="never"
          accessibilityLabel={placeholder}
          // letterSpacing: 0 is explicit — iOS leaks the sign-in OTP field's
          // tracking into later TextInputs (see LiveTabSearchField).
          style={[styles.input, { color: colors.foreground }]}
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onQuery("");
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear filter"
            style={({ pressed }) => [styles.clear, pressed && { opacity: 0.5 }]}
          >
            <Symbol name="xmark.circle.fill" size={15} color={colors.mutedForeground} fallback="✕" />
          </Pressable>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.summary, { color: colors.mutedForeground }]}>
        {summary}
      </Text>
    </View>
  );
}

/** "Show 25 more (57 left)" / "Show 7 more tabs" / "Show less". */
export function ShowMoreButton({
  hidden,
  expanded,
  nextChunk,
  noun,
  onToggle,
}: {
  hidden: number;
  expanded: boolean;
  nextChunk?: number;
  noun: string;
  onToggle: () => void;
}) {
  const { colors, radius } = useAppTheme();
  if (hidden <= 0 && !expanded) return null;
  const label = showMoreLabel(hidden, nextChunk, noun);
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.showMore,
        { borderRadius: radius.md },
        pressed && { backgroundColor: colors.muted },
      ]}
    >
      <Symbol
        name={hidden === 0 ? "chevron.up" : "chevron.down"}
        size={10}
        color={colors.mutedForeground}
        fallback={hidden === 0 ? "˄" : "˅"}
        weight="semibold"
      />
      <Text style={[styles.showMoreText, { color: colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The card's page footer: "tabs 51–100 of 92" plus "Load next 50". Rendered
 * only when there IS a next page, a non-first offset, or an error to show.
 */
export function PageFooter({
  page,
  firstOffset,
  shown,
  noun,
  loading,
  error,
  onLoadMore,
}: {
  /** The LATEST page meta (after any load more). */
  page: ToolPageMeta | undefined;
  /** Offset of the FIRST page this card holds — the tool's own `offset`. */
  firstOffset: number;
  /** Rows accumulated in the card. */
  shown: number;
  noun: string;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
}) {
  const { colors, radius } = useAppTheme();
  if (!page || !pageFooterVisible(page, firstOffset, error)) return null;
  return (
    <View style={[styles.footer, { borderTopColor: colors.border }]}>
      <Text style={[styles.footerRange, { color: colors.mutedForeground }]}>
        {noun} {describePageRange({ ...page, offset: firstOffset }, shown)}
      </Text>
      {page.hasMore && (
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            onLoadMore();
          }}
          disabled={loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading }}
          accessibilityLabel={loading ? "Loading more" : `Load next ${page.limit}`}
          style={({ pressed }) => [
            styles.loadMore,
            { borderColor: colors.border, borderRadius: radius.md },
            pressed && { backgroundColor: colors.muted },
            loading && { opacity: 0.6 },
          ]}
        >
          {loading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          <Text style={[styles.loadMoreText, { color: colors.foreground }]}>
            {loading ? "Loading…" : `Load next ${page.limit}`}
          </Text>
        </Pressable>
      )}
      {error !== null && (
        <Text style={[styles.footerError, { color: colors.destructive }]}>{error}</Text>
      )}
    </View>
  );
}

/** A tab's real favicon when the capture carried a loadable one, else the
 * host's initial in a muted dot. A broken icon URL falls back silently. */
export function TabFavicon({ src, url, size = 18 }: { src?: string | null; url: string; size?: number }) {
  const { colors } = useAppTheme();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = isRenderableFavicon(src) && src !== failedUrl;
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (showImage) {
    return (
      <View style={[styles.favicon, box, { backgroundColor: colors.muted }]}>
        <Image
          source={{ uri: src as string }}
          onError={() => setFailedUrl(src ?? null)}
          style={{ width: size * 0.7, height: size * 0.7, borderRadius: 3 }}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  return (
    <View style={[styles.favicon, box, { backgroundColor: colors.muted }]}>
      <Text style={[styles.faviconLetter, { color: colors.mutedForeground, fontSize: size * 0.5 }]}>
        {faviconInitial(url)}
      </Text>
    </View>
  );
}

/** One muted line — "No matches", "Live sharing is off", … */
export function CardNote({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.note, { color: colors.mutedForeground }]}>{children}</Text>;
}

/** A small rounded chip: filled (the category) or outlined (a tag). */
export function Chip({ label, filled }: { label: string; filled?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.chip,
        filled
          ? { backgroundColor: colors.primary }
          : { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.chipText, { color: filled ? colors.primaryForeground : colors.mutedForeground }]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 9,
    paddingRight: 6,
    minHeight: 34,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 6, letterSpacing: 0 },
  clear: { padding: 4 },
  summary: { fontSize: 12, fontVariant: ["tabular-nums"], maxWidth: "45%" },
  showMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 10,
  },
  showMoreText: { fontSize: 13, fontWeight: "500" },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRange: { fontSize: 12, fontVariant: ["tabular-nums"] },
  loadMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadMoreText: { fontSize: 13, fontWeight: "500" },
  footerError: { fontSize: 12, flexBasis: "100%" },
  favicon: { alignItems: "center", justifyContent: "center", marginTop: 1 },
  faviconLetter: { fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, maxWidth: 160 },
  chipText: { fontSize: 11, fontWeight: "500" },
});
