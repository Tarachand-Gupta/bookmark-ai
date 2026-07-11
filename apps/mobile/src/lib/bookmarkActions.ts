import { ActionSheetIOS, Alert, Linking, Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { Bookmark } from "@bookmark-ai/types";

export function openBookmark(bookmark: Bookmark): void {
  void Linking.openURL(bookmark.url);
}

/** Long-press menu: Open / Share / Copy Link — the iOS way to offer
 * secondary actions without cluttering the row. */
export function showBookmarkActions(bookmark: Bookmark): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  if (Platform.OS !== "ios") {
    // Android fallback until a proper menu lands there.
    Alert.alert(bookmark.title, bookmark.domain, [
      { text: "Open", onPress: () => openBookmark(bookmark) },
      { text: "Copy Link", onPress: () => void Clipboard.setStringAsync(bookmark.url) },
      { text: "Cancel", style: "cancel" },
    ]);
    return;
  }
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: bookmark.title,
      message: bookmark.domain,
      options: ["Open", "Share…", "Copy Link", "Cancel"],
      cancelButtonIndex: 3,
    },
    (index) => {
      if (index === 0) openBookmark(bookmark);
      if (index === 1) void Share.share({ url: bookmark.url, message: bookmark.title });
      if (index === 2) void Clipboard.setStringAsync(bookmark.url);
    },
  );
}
