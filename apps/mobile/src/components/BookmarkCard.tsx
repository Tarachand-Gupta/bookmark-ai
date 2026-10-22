import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Bookmark } from "@bookmark-ai/types";
import { useOrganization } from "../context/OrganizationContext";
import { useOrganizationUi } from "../context/OrganizationUiContext";
import { useComposer } from "../context/ComposerContext";
import { useAppTheme } from "../context/PreferencesContext";
import { openBookmark, showBookmarkActions } from "../lib/bookmarkActions";
import { FaviconTile } from "./BookmarkRow";

/** Card view: OG image (favicon-tile fallback), 15pt two-line title, domain
 * and category chip. Tap opens, long-press shows the action sheet. */
export function BookmarkCard({ bookmark, selecting=false, selected=false, onSelect }: { bookmark: Bookmark; selecting?:boolean; selected?:boolean; onSelect?:(bookmark:Bookmark)=>void }) {
  const org=useOrganization(),ui=useOrganizationUi(),composer=useComposer();
  const supported=!!org.data?.capabilities.organization&&!!org.accountId&&!org.offline;
  const menu=()=>showBookmarkActions(bookmark,supported?{edit:()=>ui?.edit(bookmark),select:onSelect?()=>onSelect(bookmark):undefined,ask:()=>composer.open({type:'bookmarks',bookmarkIds:[bookmark.id]})}:{});
  const { colors, radius } = useAppTheme();
  // Keyed on the url that failed rather than a sticky flag, so the OG image the
  // server scrapes moments after a save isn't hidden behind a stale failure.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = bookmark.og.image !== failedImage ? bookmark.og.image : null;

  return (
    <Pressable
      onPress={() => selecting?onSelect?.(bookmark):openBookmark(bookmark)}
      onLongPress={() => onSelect&&supported?onSelect(bookmark):menu()}
      accessibilityRole={selecting?"checkbox":"link"}
      accessibilityState={selecting?{checked:selected}:undefined}
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
            onError={() => setFailedImage(image)}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <FaviconTile url={bookmark.og.favicon} size={44} />
        )}
      </View>
      <View style={styles.body}>{selecting&&<Text style={{color:colors.foreground,fontSize:20}}>{selected?"☑ Selected":"☐ Select"}</Text>}{!selecting&&supported&&<Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${bookmark.title}`} onPress={menu} style={{minHeight:44,alignItems:"flex-end",justifyContent:"center"}}><Text style={{color:colors.foreground,fontSize:22}}>⋯</Text></Pressable>}
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
