import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Linking, LogBox, StyleSheet, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { setAuthTokenProvider } from "./src/api";
import { PreferencesProvider, useAppTheme, usePreferences } from "./src/context/PreferencesContext";
import type { SessionsSegment } from "./src/hooks/useLiveDevices";
import { CLERK_PUBLISHABLE_KEY, tokenCache } from "./src/lib/clerk";
import type { NavTarget } from "./src/navigation/intents";
import { TabBar, type TabKey } from "./src/navigation/TabBar";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { SignInScreen } from "./src/screens/SignInScreen";

// Only fires when the dev Clerk instance is used for local development (the
// production default doesn't emit it); silenced to keep the log clean.
LogBox.ignoreLogs([/Clerk has been loaded with development keys/]);

export default function App() {
  return (
    <PreferencesProvider>
      <ClerkGate />
    </PreferencesProvider>
  );
}

/**
 * Mounts ClerkProvider once with this build's publishable key (CLERK_PUBLISHABLE_KEY
 * is a build-time constant derived from SERVER_TARGET — there is no in-app server
 * switch, so the provider never needs to remount). We still gate the first paint
 * on `hydrated` (persisted theme/view read from storage) to avoid a theme flash.
 */
function ClerkGate() {
  const { colors } = useAppTheme();
  const { hydrated } = usePreferences();

  if (!hydrated) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.splash}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      {/* initialMetrics avoids the Android first-frame zero-inset flash
          (Settings title rendered under the status bar on first mount). */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Gate />
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

// Dev-only QA affordance: lets headless test agents past the sign-in gate to
// exercise the UI against the open local server. Ignored in release builds.
const SKIP_AUTH = __DEV__ && process.env.EXPO_PUBLIC_SKIP_AUTH === "1";

/** Auth gate: splash while Clerk restores the session, sign-in when there is
 * none, the app otherwise. Also feeds the session token to the API client. */
function Gate() {
  const { colors, dark } = useAppTheme();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    setAuthTokenProvider(() => getToken());
  }, [getToken]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!isLoaded && !SKIP_AUTH ? (
        <View style={styles.splash}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : !isSignedIn && !SKIP_AUTH ? (
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.body}>
          <SignInScreen />
        </SafeAreaView>
      ) : (
        <Shell />
      )}
      <StatusBar style={dark ? "light" : "dark"} />
    </View>
  );
}

// Dev/screenshot affordance: EXPO_PUBLIC_INITIAL_TAB=home|library|sessions|search|settings|filters
// (inlined at bundle time; unset in normal use → Home, the landing tab).
const INITIAL = process.env.EXPO_PUBLIC_INITIAL_TAB;

function initialTab(): TabKey {
  if (
    INITIAL === "home" ||
    INITIAL === "library" ||
    INITIAL === "sessions" ||
    INITIAL === "search" ||
    INITIAL === "settings"
  ) {
    return INITIAL;
  }
  // EXPO_PUBLIC_INITIAL_TAB=filters opens the Library with its sheet up.
  return INITIAL === "filters" ? "library" : "home";
}

function Shell() {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [filterSheetOpen, setFilterSheetOpen] = useState(INITIAL === "filters");

  // One-shot cross-tab requests (see src/navigation/intents.ts). Screens stay
  // mounted, so a "navigation" is a tab switch plus a request the target screen
  // consumes and clears — no nav library, no route table.
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [libraryTag, setLibraryTag] = useState<string | null>(null);
  const [sessionsSegment, setSessionsSegment] = useState<SessionsSegment | null>(null);
  // A counter, not a boolean: tapping Home's search field twice must re-focus
  // the Search field both times.
  const [searchFocus, setSearchFocus] = useState(0);

  const navigate = useCallback((target: NavTarget) => {
    setTab(target.tab);
    if (target.tab === "library") {
      if (target.tag !== undefined) setLibraryTag(target.tag);
      if (target.add === true) setAddSheetOpen(true);
    } else if (target.tab === "sessions") {
      if (target.segment !== undefined) setSessionsSegment(target.segment);
    } else if (target.tab === "search") {
      if (target.focus === true) setSearchFocus((n) => n + 1);
    }
  }, []);

  const clearLibraryTag = useCallback(() => setLibraryTag(null), []);
  const clearSessionsSegment = useCallback(() => setSessionsSegment(null), []);

  // Deep links: bookmarkai://tab/<home|library|sessions|search|settings>, bookmarkai://filters
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const match = /(?:tab\/)?(home|library|sessions|search|settings|filters)\/?$/.exec(url);
      if (!match) return;
      if (match[1] === "filters") {
        setTab("library");
        setFilterSheetOpen(true);
      } else {
        setTab(match[1] as TabKey);
      }
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  // Android's frosted tab bar samples this wrapper (expo-blur blurTarget);
  // it's a plain passthrough view on iOS.
  const blurTargetRef = useRef<View>(null);

  // Screens stay mounted so tab switches keep scroll position and state.
  return (
    <>
      <BlurTargetView ref={blurTargetRef} style={styles.body}>
        <SafeAreaView edges={["top", "left", "right"]} style={styles.body}>
          <View style={[styles.screen, tab !== "home" && styles.hidden]}>
            <HomeScreen active={tab === "home"} onNavigate={navigate} />
          </View>
          <View style={[styles.screen, tab !== "library" && styles.hidden]}>
            <LibraryScreen
              active={tab === "library"}
              filterSheetOpen={filterSheetOpen}
              onFilterSheetChange={setFilterSheetOpen}
              addSheetOpen={addSheetOpen}
              onAddSheetChange={setAddSheetOpen}
              requestedTag={libraryTag}
              onRequestedTagHandled={clearLibraryTag}
            />
          </View>
          <View style={[styles.screen, tab !== "sessions" && styles.hidden]}>
            <SessionsScreen
              active={tab === "sessions"}
              onOpenSettings={() => setTab("settings")}
              requestedSegment={sessionsSegment}
              onRequestedSegmentHandled={clearSessionsSegment}
            />
          </View>
          <View style={[styles.screen, tab !== "search" && styles.hidden]}>
            <SearchScreen focusRequest={searchFocus} />
          </View>
          <View style={[styles.screen, tab !== "settings" && styles.hidden]}>
            <SettingsScreen />
          </View>
        </SafeAreaView>
      </BlurTargetView>
      <TabBar tab={tab} onChange={setTab} blurTarget={blurTargetRef} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: "none" },
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
