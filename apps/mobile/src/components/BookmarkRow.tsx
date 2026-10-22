import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Bookmark } from "@bookmark-ai/types";
import { useOrganization } from "../context/OrganizationContext";
import { useOrganizationUi } from "../context/OrganizationUiContext";
import { useComposer } from "../context/ComposerContext";
import { useAppTheme } from "../context/PreferencesContext";
import { openBookmark, showBookmarkActions } from "../lib/bookmarkActions";

/** List row at iOS scale: 36pt icon tile (Settings-style), 17pt title,
 * domain subtitle. Tap opens, long-press shows the action sheet. */
export function BookmarkRow({ bookmark, last, selecting=false, selected=false, onSelect }: { bookmark: Bookmark; last?: boolean; selecting?:boolean; selected?:boolean; onSelect?:(bookmark:Bookmark)=>void }) {
  const org=useOrganization(),ui=useOrganizationUi(),composer=useComposer();
  const supported=!!org.data?.capabilities.organization&&!!org.accountId&&!org.offline;
  const menu=()=>showBookmarkActions(bookmark,supported?{edit:()=>ui?.edit(bookmark),select:onSelect?()=>onSelect(bookmark):undefined,ask:()=>composer.open({type:'bookmarks',bookmarkIds:[bookmark.id]})}:{});
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={() => selecting?onSelect?.(bookmark):openBookmark(bookmark)}
      onLongPress={() => onSelect&&supported?onSelect(bookmark):menu()}
      accessibilityRole={selecting?"checkbox":"link"}
      accessibilityState={selecting?{checked:selected}:undefined}
      style={({ pressed }) => [{ backgroundColor: pressed ? colors.muted : "transparent" }]}
    >
      <View style={styles.inner}>
        {selecting&&<Text style={{color:colors.foreground,fontSize:20}}>{selected?"☑":"☐"}</Text>}<FaviconTile url={bookmark.og.favicon} />
        <View style={[styles.textCol, !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
            {bookmark.title}
          </Text>
          <Text numberOfLines={1} style={[styles.domain, { color: colors.mutedForeground }]}>
            {bookmark.domain}
          </Text>
        </View>
        {!selecting&&supported&&<Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${bookmark.title}`} onPress={menu} style={{minWidth:44,minHeight:44,alignItems:"center",justifyContent:"center"}}><Text style={{color:colors.foreground,fontSize:22}}>⋯</Text></Pressable>}
      </View>
    </Pressable>
  );
}

/** Only schemes RN's Image can actually load. Live tabs come off real browser
 * windows, so their favicon can be `chrome://`, `chrome-extension://` or a
 * `moz-extension://` url that would just fail to decode — those fall back to
 * the neutral dot instead of hitting the image loader. */
function isRenderableFavicon(url?: string | null): boolean {
  return Boolean(url) && /^(https?:|data:image\/)/i.test(url as string);
}

export function FaviconTile({ url, size = 36 }: { url?: string | null; size?: number }) {
  const { colors, radius } = useAppTheme();
  // Which url the failure belongs to, not a sticky boolean: a broken favicon
  // falls back to the neutral dot, but a later refresh that swaps in a working
  // one (the server backfills OG data seconds after a save) still gets tried.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = isRenderableFavicon(url) && url !== failedUrl;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: colors.muted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {showImage ? (
        <Image
          source={{ uri: url as string }}
          onError={() => setFailedUrl(url ?? null)}
          style={{ width: size * 0.55, height: size * 0.55, borderRadius: 4 }}
        />
      ) : (
        <View
          style={{
            width: size * 0.4,
            height: size * 0.4,
            borderRadius: size * 0.2,
            backgroundColor: colors.border,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 20,
  },
  textCol: {
    flex: 1,
    gap: 2,
    paddingVertical: 11,
    paddingRight: 20,
  },
  title: { fontSize: 17, fontWeight: "500", letterSpacing: -0.2 },
  domain: { fontSize: 13 },
});
