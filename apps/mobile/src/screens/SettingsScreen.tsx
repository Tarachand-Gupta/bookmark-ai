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
import { getApiUrl, SERVER_TARGET } from "../api";
import { Symbol } from "../components/Symbol";
import {
  useAppTheme,
  usePreferences,
  type ThemePreference,
} from "../context/PreferencesContext";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

const WEB_URL = "https://bookmark-ai.cloud";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Which backend this build talks to, shown read-only. The target is chosen at
// build time (dev run → local, release → production); there is no in-app switch.
const SERVER_HOST = getApiUrl().replace(/^https?:\/\//, "");

/** Settings tab: signed-in account card, appearance override, links — iOS
 * inset-grouped lists. The server is fixed by the build, so it's shown as a
 * read-only info row rather than a toggle. */
export function SettingsScreen() {
  const { colors } = useAppTheme();
  const { themePreference, setThemePreference } = usePreferences();
  const { user } = useUser();
  const { signOut } = useClerk();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();
  const [avatarFailed, setAvatarFailed] = useState(false);

  // user is null only in the dev auth-bypass session (EXPO_PUBLIC_SKIP_AUTH);
  // a real session always has a user by the time the Shell renders.
  const signedIn = user != null;
  const name = signedIn
    ? user.fullName || user.username || user.primaryEmailAddress?.emailAddress || "Signed in"
    : "Not signed in";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll need to sign in again to browse your library.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
      onScroll={onScroll}
      scrollEventThrottle={16}
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

      <GroupLabel>About</GroupLabel>
      <Group>
        {/* Which backend a build talks to is a build-time decision (api.ts
            resolveServerTarget), not a user choice — surface it only in dev
            builds where QA actually needs to confirm the target. */}
        {__DEV__ ? (
          <GroupRow
            first
            symbol={SERVER_TARGET === "local" ? "laptopcomputer" : "cloud"}
            label="Server"
            detail={SERVER_HOST}
          />
        ) : null}
        <GroupRow
          first={!__DEV__}
          symbol="safari"
          label="Open web app"
          chevron
          onPress={() => void Linking.openURL(WEB_URL)}
        />
      </Group>

      <GroupLabel>Account</GroupLabel>
      <Group>
        {signedIn ? (
          <GroupRow
            first
            symbol="rectangle.portrait.and.arrow.right"
            label="Sign Out"
            destructive
            onPress={confirmSignOut}
          />
        ) : (
          <GroupRow first symbol="person.fill" label="Developer session" detail="no account" />
        )}
      </Group>
      {!signedIn && (
        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          This build was started with the sign-in gate bypassed (EXPO_PUBLIC_SKIP_AUTH — dev
          only). Restart the dev server without the flag to use the real sign-in flow.
        </Text>
      )}
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
  // paddingTop 8 / paddingHorizontal 20 is exactly the `header` block
  // Library/Search/Sessions use, so all four large titles share one baseline.
  // (paddingBottom is supplied per-render as the tab-bar clearance.)
  content: { paddingHorizontal: 20, paddingTop: 8 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
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
