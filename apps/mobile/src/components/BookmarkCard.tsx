import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Bookmark } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";
import { openBookmark, showBookmarkActions } from "../lib/bookmarkActions";
import { FaviconTile } from "./BookmarkRow";

/** Card view: OG image (favicon-tile fallback), 15pt two-line title, domain
 * and category chip. Tap opens, long-press shows the action sheet. */
export function BookmarkCard({ bookmark }: { bookmark: Bookmark }) {
  const { colors, radius } = useAppTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const image = !imageFailed ? bookmark.og.image : null;

  return (
    <Pressable
      onPress={() => openBookmark(bookmark)}
      onLongPress={() => showBookmarkActions(bookmark)}
      accessibilityRole="link"
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.xl,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.media, { backgroundColor: colors.muted }]}>
        {image ? (
          <Image
            source={{ uri: image }}
            onError={() => setImageFailed(true)}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <FaviconTile url={bookmark.og.favicon} size={44} />
        )}
      </View>
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.cardForeground }]}>
          {bookmark.title}
        </Text>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={[styles.domain, { color: colors.mutedForeground }]}>
            {bookmark.domain}
          </Text>
          <View style={[styles.badge, { backgroundColor: colors.primary, borderRadius: 999 }]}>
            <Text numberOfLines={1} style={[styles.badgeText, { color: colors.primaryForeground }]}>
              {bookmark.category}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  media: {
    aspectRatio: 1.6,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { gap: 8, padding: 12 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20, minHeight: 40, letterSpacing: -0.2 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  domain: { flexShrink: 1, fontSize: 12 },
  badge: { maxWidth: "60%", paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "600" },
});
