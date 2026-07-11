import { Platform, Text } from "react-native";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

/** SF Symbol on iOS; plain-text glyph fallback elsewhere (Android build has
 * no SF Symbols — pass a `fallback` character). */
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
    return <Text style={{ fontSize: size * 0.9, color }}>{fallback}</Text>;
  }
  return (
    <SymbolView name={name} size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit" />
  );
}
