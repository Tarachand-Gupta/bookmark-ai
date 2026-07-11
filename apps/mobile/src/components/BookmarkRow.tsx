import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { Bookmark } from "@bookmark-ai/types";
import { useTheme } from "../theme";

/** Single-line view: favicon · title · domain — the mobile twin of the web
 * app's compact row. */
export function BookmarkRow({ bookmark }: { bookmark: Bookmark }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => void Linking.openURL(bookmark.url)}
      accessibilityRole="link"
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
      ]}
    >
      <Favicon url={bookmark.og.favicon} />
      <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
        {bookmark.title}
      </Text>
      <Text numberOfLines={1} style={[styles.domain, { color: colors.mutedForeground }]}>
        {bookmark.domain}
      </Text>
    </Pressable>
  );
}

export function Favicon({ url, size = 16 }: { url?: string | null; size?: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 4,
          backgroundColor: colors.muted,
        }}
      />
    );
  }
  return (
    <Image
      source={{ uri: url }}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: size / 4 }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 15, fontWeight: "500" },
  domain: { fontSize: 12, maxWidth: 110 },
});
