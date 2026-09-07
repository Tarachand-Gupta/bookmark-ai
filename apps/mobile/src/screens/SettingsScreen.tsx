import { useState } from "react";
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useClerk, useUser } from "@clerk/clerk-expo";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { getApiUrl, SERVER_TARGET } from "../api";
import { DeleteAccountSheet } from "../components/DeleteAccountSheet";
import { AiSettingsGroup } from "../components/settings/AiSettingsGroup";
import { PlanBadge, PlanCard } from "../components/settings/PlanCard";
import { Group, GroupFootnote, GroupLabel, GroupRow } from "../components/settings/SettingsGroup";
import { Symbol } from "../components/Symbol";
import {
  useAppTheme,
  usePreferences,
  type ThemePreference,
} from "../context/PreferencesContext";
import { useAiPlan } from "../hooks/useAiPlan";

// `www` is the canonical host (the apex 308s to it — see PROD_API_URL in api.ts).
const WEB_URL = "https://www.bookmark-ai.cloud";
/**
 * Both stores require the privacy policy to be reachable from INSIDE the app
 * (App Store guideline 5.1.1(i); Play's User Data policy), not only from the
 * store listing. Same URLs the listings will carry.
 */
const PRIVACY_URL = `${WEB_URL}/privacy`;
const TERMS_URL = `${WEB_URL}/terms`;
const SUPPORT_EMAIL = "tara@purecode.ai";

/** This binary's marketing version + build, e.g. "1.0.0 (1)" — what a support
 * reply needs first. expo-application reads CFBundleShortVersionString/
 * CFBundleVersion (iOS) and versionName/versionCode (Android); both are null
 * only in Expo Go, where the row simply shows nothing. */
const APP_VERSION = Application.nativeApplicationVersion
  ? `${Application.nativeApplicationVersion} (${Application.nativeBuildVersion ?? "—"})`
  : null;

/** Legal pages open in the in-app browser sheet (SFSafariViewController /
 * Chrome Custom Tab) so the user lands back in Settings when they're done. A
 * refused URL falls through to the system browser; both failing is silent. */
function openWebPage(url: string): void {
  void WebBrowser.openBrowserAsync(url).catch(() =>
    Linking.openURL(url).catch(() => undefined),
  );
}

/** "Contact support" — the mail composer when a mail app exists, otherwise an
 * alert with the address and a Copy action, so the email is never a dead end
 * (simulators and many Android devices have no mail client). */
function contactSupport(): void {
  const subject = encodeURIComponent(
    `Bookmark AI support${APP_VERSION ? ` (app ${APP_VERSION})` : ""}`,
  );
  Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => {
    Alert.alert("Contact support", `Email us at ${SUPPORT_EMAIL}`, [
      { text: "Copy address", onPress: () => void Clipboard.setStringAsync(SUPPORT_EMAIL) },
      { text: "OK", style: "cancel" },
    ]);
  });
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Which backend this build talks to, shown read-only. The target is chosen at
// build time (dev run → local, release → production); there is no in-app switch.
const SERVER_HOST = getApiUrl().replace(/^https?:\/\//, "");

/** Settings: signed-in account card with its plan badge, the Plan and Ask AI
 * groups (`/api/account` + `/api/settings`), appearance override, links — iOS
 * inset-grouped lists. The server is fixed by the build, so it's shown as a
 * read-only info row rather than a toggle. No longer a tab and no longer its own
 * large title: SettingsPresentation (src/navigation) presents it full-screen
 * with a "Settings" header, so there's no tab bar to clear either. */
export function SettingsScreen() {
  const { colors } = useAppTheme();
  const { themePreference, setThemePreference } = usePreferences();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  // Loads when the presentation opens (the Modal mounts this screen on show).
  const ai = useAiPlan();

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

  /**
   * Step 1 of account deletion (App Store guideline 5.1.1(v)): an Alert that
   * states the consequence before the typed-confirmation sheet even opens, so a
   * mis-tap on the row can never reach the armed button.
   */
  const startDelete = () => {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account and every bookmark and session in it. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", style: "destructive", onPress: () => setDeleteSheetOpen(true) },
      ],
    );
  };

  /**
   * The account is gone server-side; drop the local session so the app lands
   * back on the sign-in screen. `signOut()` talks to Clerk, whose user no longer
   * exists, so a throw here is EXPECTED — swallow it (the token cache is cleared
   * either way) and tell the user it worked, because it did.
   */
  const finishDelete = () => {
    setDeleteSheetOpen(false);
    void signOut().catch(() => undefined);
    Alert.alert("Account deleted", "Your account and all of its data have been removed.");
  };

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
      >
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
          <PlanBadge plan={ai.plan} />
        </View>

        <PlanCard plan={ai.plan} />

        <AiSettingsGroup state={ai} />

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
            onPress={() => void Linking.openURL(WEB_URL).catch(() => undefined)}
          />
          {APP_VERSION !== null && (
            <GroupRow symbol="info.circle" label="Version" detail={APP_VERSION} />
          )}
        </Group>

        {/* Store requirement, not decoration: the privacy policy must be
            reachable in-app (App Store 5.1.1(i), Play User Data policy), and a
            support contact is what the listings' Support URL promises. */}
        <GroupLabel>Legal & Support</GroupLabel>
        <Group>
          <GroupRow
            first
            symbol="hand.raised"
            label="Privacy Policy"
            chevron
            onPress={() => openWebPage(PRIVACY_URL)}
          />
          <GroupRow
            symbol="doc.text"
            label="Terms of Service"
            chevron
            onPress={() => openWebPage(TERMS_URL)}
          />
          <GroupRow
            symbol="envelope"
            label="Contact Support"
            detail={SUPPORT_EMAIL}
            chevron
            onPress={contactSupport}
          />
        </Group>

        <GroupLabel>Account</GroupLabel>
        <Group>
          {signedIn ? (
            <>
              <GroupRow
                first
                symbol="rectangle.portrait.and.arrow.right"
                label="Sign Out"
                destructive
                onPress={confirmSignOut}
              />
              {/* App Store guideline 5.1.1(v): an app that creates accounts must
                  offer in-app account DELETION, not just a support link. Below
                  Sign Out so the safe action stays the easy one. */}
              <GroupRow symbol="trash" label="Delete Account" destructive onPress={startDelete} />
            </>
          ) : (
            <GroupRow first symbol="person.fill" label="Developer session" detail="no account" />
          )}
        </Group>
        {signedIn && (
          <GroupFootnote>
            Deleting your account permanently removes your bookmarks, sessions, and sign-in. This
            cannot be undone.
          </GroupFootnote>
        )}
        {!signedIn && (
          <GroupFootnote>
            This build was started with the sign-in gate bypassed (EXPO_PUBLIC_SKIP_AUTH — dev
            only). Restart the dev server without the flag to use the real sign-in flow.
          </GroupFootnote>
        )}
      </ScrollView>
      {/* Step 2 of deletion: the typed-confirmation sheet. A sibling of the
          list, not a scrollable child. */}
      <DeleteAccountSheet
        visible={deleteSheetOpen}
        email={email}
        onClose={() => setDeleteSheetOpen(false)}
        onDeleted={finishDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Presented full-screen under its own header, so this is plain list padding —
  // no large title above it and no floating tab bar below it to clear.
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
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
});
