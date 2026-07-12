import { useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useClerk, useUser } from "@clerk/clerk-expo";
import type { SymbolViewProps } from "expo-symbols";
import { LOCAL_API_URL, PROD_API_URL, type ServerTarget } from "../api";
import { Symbol } from "../components/Symbol";
import {
  useAppTheme,
  usePreferences,
  type ThemePreference,
} from "../context/PreferencesContext";
import { useLibrary } from "../hooks/useLibrary";
import { useTabBarClearance } from "../navigation/TabBar";

const WEB_URL = "https://bookmark-ai-theta.vercel.app";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SERVER_OPTIONS: { value: ServerTarget; label: string; detail: string }[] = [
  { value: "local", label: "Local", detail: LOCAL_API_URL.replace(/^https?:\/\//, "") },
  { value: "production", label: "Production", detail: PROD_API_URL.replace(/^https?:\/\//, "") },
];

/** Settings tab: signed-in account card, appearance override, server
 * selector (local dev vs deployed API), links — iOS inset-grouped lists. */
export function SettingsScreen() {
  const { colors } = useAppTheme();
  const { themePreference, setThemePreference, serverTarget, setServerTarget } = usePreferences();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { meta, refresh } = useLibrary();
  const tabBarClearance = useTabBarClearance();
  const [avatarFailed, setAvatarFailed] = useState(false);

  const name = user?.fullName || user?.username || "Signed in";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll need to sign in again to browse your library.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  const pickServer = (target: ServerTarget) => {
    setServerTarget(target);
    refresh(); // reload against the newly selected API
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
    >
      <Text style={[styles.largeTitle, { color: colors.foreground }]}>Settings</Text>

      <View style={styles.profile}>
        {user?.imageUrl && !avatarFailed ? (
          <Image
            source={{ uri: user.imageUrl }}
            onError={() => setAvatarFailed(true)}
            style={styles.avatarImage}
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Symbol
              name="person.fill"
              size={26}
              color={colors.primaryForeground}
              fallback={name.slice(0, 1).toUpperCase()}
            />
          </View>
        )}
        <Text style={[styles.profileName, { color: colors.foreground }]}>{name}</Text>
        {email.length > 0 && (
          <Text style={[styles.profileMeta, { color: colors.mutedForeground }]}>{email}</Text>
        )}
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
        {SERVER_OPTIONS.map((option, i) => (
          <GroupRow
            key={option.value}
            first={i === 0}
            symbol={option.value === "local" ? "laptopcomputer" : "cloud"}
            label={option.label}
            detail={option.detail}
            onPress={() => pickServer(option.value)}
            trailing={
              serverTarget === option.value ? (
                <Symbol name="checkmark" size={16} color={colors.foreground} fallback="✓" weight="semibold" />
              ) : null
            }
          />
        ))}
        <GroupRow
          symbol="safari"
          label="Open web app"
          chevron
          onPress={() => void Linking.openURL(WEB_URL)}
        />
      </Group>
      <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
        Production requires this signed-in account — the deployed API verifies every request.
        Local talks to the open dev server on this machine.
      </Text>

      <GroupLabel>Account</GroupLabel>
      <Group>
        <GroupRow
          first
          symbol="rectangle.portrait.and.arrow.right"
          label="Sign Out"
          destructive
          onPress={confirmSignOut}
        />
      </Group>
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
  destructive,
  onPress,
}: {
  label: string;
  detail?: string;
  symbol?: SymbolViewProps["name"];
  trailing?: React.ReactNode;
  chevron?: boolean;
  first?: boolean;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const labelColor = destructive ? colors.destructive : colors.foreground;
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
      {symbol && (
        <Symbol
          name={symbol}
          size={20}
          color={destructive ? colors.destructive : colors.mutedForeground}
          fallback="•"
        />
      )}
      <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
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
  content: { padding: 20 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2, paddingTop: 8 },
  profile: { alignItems: "center", gap: 4, paddingVertical: 24 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32, marginBottom: 6 },
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
  rowDetail: { fontSize: 15, maxWidth: "50%" },
  footnote: { fontSize: 13, lineHeight: 18, marginTop: 10, marginHorizontal: 4 },
});
