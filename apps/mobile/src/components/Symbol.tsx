import { Platform, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

/** SF Symbol name → Ionicons equivalent for Android (Ionicons' visual
 * language is iOS-flavored, so the two platforms read the same). */
const ANDROID_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  "arrow.clockwise": "refresh",
  "arrow.up.circle.fill": "arrow-up-circle",
  "arrow.up.right": "open-outline",
  bookmark: "bookmark-outline",
  "bookmark.fill": "bookmark",
  "books.vertical": "library-outline",
  "books.vertical.fill": "library",
  checkmark: "checkmark",
  "checkmark.circle.fill": "checkmark-circle",
  "chevron.down": "chevron-down",
  "chevron.left": "chevron-back",
  "chevron.right": "chevron-forward",
  "chevron.up": "chevron-up",
  cloud: "cloud-outline",
  // Ask AI: markdown/tool chips + the composer and thread chrome.
  "doc.text": "document-text-outline",
  desktopcomputer: "desktop-outline",
  display: "desktop-outline",
  "doc.on.clipboard": "clipboard-outline",
  // Live sessions (Sessions tab + its Live segment). SF has no .fill variant,
  // so both states map to the same glyph and the tint carries "active".
  "dot.radiowaves.left.and.right": "radio-outline",
  "exclamationmark.shield": "shield-outline",
  "exclamationmark.triangle": "warning-outline",
  "exclamationmark.triangle.fill": "warning",
  "eye.slash": "eye-off-outline",
  gearshape: "settings-outline",
  "gearshape.fill": "settings",
  globe: "globe-outline",
  house: "home-outline",
  "house.fill": "home",
  iphone: "phone-portrait-outline",
  ipad: "tablet-portrait-outline",
  laptopcomputer: "laptop-outline",
  "line.3.horizontal.decrease": "filter",
  "list.bullet": "list",
  macwindow: "browsers-outline",
  magnifyingglass: "search",
  "person.fill": "person",
  plus: "add",
  "questionmark.circle": "help-circle-outline",
  "rectangle.portrait.and.arrow.right": "log-out-outline",
  safari: "compass-outline",
  sparkles: "sparkles",
  "square.and.pencil": "create-outline",
  "square.grid.2x2": "grid-outline",
  "square.stack": "albums-outline",
  "square.stack.fill": "albums",
  "stop.circle.fill": "stop-circle",
  tablecells: "server-outline",
  trash: "trash-outline",
  "xmark.circle.fill": "close-circle",
};

/** SF Symbol on iOS; the mapped Ionicons glyph on Android (text character as
 * a last resort for unmapped names — add new names to ANDROID_ICONS). */
export function Symbol({
  name,
  size = 20,
  color,
  fallback = "•",
  weight,
}: {
  name: SymbolViewProps["name"];
  size?: number;
  color: string;
  fallback?: string;
  weight?: SymbolViewProps["weight"];
}) {
  if (Platform.OS !== "ios") {
    const ionName = typeof name === "string" ? ANDROID_ICONS[name] : undefined;
    if (ionName) {
      return <Ionicons name={ionName} size={size} color={color} />;
    }
    return <Text style={{ fontSize: size * 0.9, color }}>{fallback}</Text>;
  }
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
    />
  );
}
