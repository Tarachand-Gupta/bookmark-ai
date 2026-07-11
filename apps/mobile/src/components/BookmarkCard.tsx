import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { Bookmark } from "@bookmark-ai/types";
import { useTheme } from "../theme";
import { Favicon } from "./BookmarkRow";

/** Small card view: OG image (favicon-on-muted fallback), title, domain and
 * the category chip in the web card view's filled-primary style. */
export function BookmarkCard({ bookmark }: { bookmark: Bookmark }) {
  const { colors, radius } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const image = !imageFailed ? bookmark.og.image : null;

  return (
    <Pressable
      onPress={() => void Linking.openURL(bookmark.url)}
      accessibilityRole="link"
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
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
          <Favicon url={bookmark.og.favicon} size={32} />
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
          <View
            style={[styles.badge, { backgroundColor: colors.primary, borderRadius: radius.sm }]}
          >
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
    // Web card elevation: shadow-sm.
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  media: {
    aspectRatio: 1.91,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { gap: 6, padding: 10 },
  title: { fontSize: 13.5, fontWeight: "600", lineHeight: 18, minHeight: 36 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  domain: { flexShrink: 1, fontSize: 11 },
  badge: { maxWidth: "55%", paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "500" },
});
