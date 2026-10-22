import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";

export function GettingStartedCard({
  onSaveLink,
  onImport,
  onDismiss,
}: {
  onSaveLink: () => void;
  onImport: () => void;
  onDismiss?: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.foreground }]} accessibilityRole="header">
        Make this library yours
      </Text>
      <Text style={[styles.copy, { color: colors.mutedForeground }]}>
        Save a link or bring your existing bookmarks. Then search for a title, organize it, or ask
        AI about it.
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onSaveLink}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Save a link</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onImport}
          style={[styles.button, { borderColor: colors.border, borderWidth: 1 }]}
        >
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>Import existing links</Text>
        </Pressable>
        {onDismiss && (
          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.button}>
            <Text style={{ color: colors.mutedForeground }}>Later</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 18, gap: 10 },
  title: { fontSize: 18, fontWeight: "600" },
  copy: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 8,
    justifyContent: "center",
  },
});
