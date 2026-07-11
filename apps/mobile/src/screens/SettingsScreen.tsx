import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SymbolViewProps } from "expo-symbols";
import { API_URL } from "../api";
import { Symbol } from "../components/Symbol";
import {
  useAppTheme,
  usePreferences,
  type ThemePreference,
} from "../context/PreferencesContext";
import { useLibrary } from "../hooks/useLibrary";

const WEB_URL = "https://bookmark-ai-theta.vercel.app";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Settings tab: iOS inset-grouped lists — library stats, appearance
 * override, server info, links. */
export function SettingsScreen() {
  const { colors } = useAppTheme();
  const { themePreference, setThemePreference } = usePreferences();
  const { meta } = useLibrary();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.largeTitle, { color: colors.foreground }]}>Settings</Text>

      <View style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Symbol name="bookmark.fill" size={26} color={colors.primaryForeground} fallback="B" />
        </View>
        <Text style={[styles.profileName, { color: colors.foreground }]}>Bookmark AI</Text>
        <Text style={[styles.profileMeta, { color: colors.mutedForeground }]}>
          {meta
            ? `${meta.total} bookmarks · ${meta.categories.length} categories · ${meta.tags.length} tags`
            : "Loading library stats…"}
        </Text>
      </View>

      <GroupLabel>Appearance</GroupLabel>
      <Group>
        {THEME_OPTIONS.map((option, i) => (
          <GroupRow
            key={option.value}
            first={i === 0}
            label={option.label}
            onPress={() => setThemePreference(option.value)}
            trailing={
              themePreference === option.value ? (
                <Symbol name="checkmark" size={16} color={colors.foreground} fallback="✓" weight="semibold" />
              ) : null
            }
          />
        ))}
      </Group>

      <GroupLabel>Server</GroupLabel>
      <Group>
        <GroupRow first symbol="server.rack" label="API" detail={API_URL.replace(/^https?:\/\//, "")} />
        <GroupRow
          symbol="safari"
          label="Open web app"
          chevron
          onPress={() => void Linking.openURL(WEB_URL)}
        />
      </Group>

      <GroupLabel>Account</GroupLabel>
      <Group>
        <GroupRow
          first
          symbol="person.crop.circle"
          label="Sign in"
          detail="Coming soon"
        />
      </Group>
      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        The local server is open on this network; sign-in arrives with Clerk mobile auth when the
        app talks to the deployed API.
      </Text>
    </ScrollView>
  );
}

function GroupLabel({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return (
    <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
      {children.toUpperCase()}
    </Text>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.group,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      {children}
    </View>
  );
}

function GroupRow({
  label,
  detail,
  symbol,
  trailing,
  chevron,
  first,
  onPress,
}: {
  label: string;
  detail?: string;
  symbol?: SymbolViewProps["name"];
  trailing?: React.ReactNode;
  chevron?: boolean;
  first?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && onPress ? { backgroundColor: colors.muted } : null,
      ]}
    >
      {symbol && <Symbol name={symbol} size={20} color={colors.mutedForeground} fallback="•" />}
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
      {detail && (
        <Text numberOfLines={1} style={[styles.rowDetail, { color: colors.mutedForeground }]}>
          {detail}
        </Text>
      )}
      {trailing}
      {chevron && <Symbol name="chevron.right" size={14} color={colors.mutedForeground} fallback="›" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2, paddingTop: 8 },
  profile: { alignItems: "center", gap: 6, paddingVertical: 24 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  profileName: { fontSize: 20, fontWeight: "600" },
  profileMeta: { fontSize: 13 },
  groupLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowLabel: { flex: 1, fontSize: 17 },
  rowDetail: { fontSize: 15, maxWidth: "55%" },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 10, marginHorizontal: 4 },
});
