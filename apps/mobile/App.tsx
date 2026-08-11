import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Linking, LogBox, StyleSheet, View } from "react-native";
import { BlurTargetView } from "expo-blur";
import * as SplashScreen from "expo-splash-screen";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { ShareIntentProvider } from "expo-share-intent";
import { setAuthTokenProvider } from "./src/api";
import { ShareSavedBanner } from "./src/components/ShareSavedBanner";
import { PreferencesProvider, useAppTheme, usePreferences } from "./src/context/PreferencesContext";
import { useAccountStatus } from "./src/hooks/useAccountStatus";
import type { SessionsSegment } from "./src/hooks/useLiveDevices";
import { AccountSetupScreen } from "./src/screens/AccountSetupScreen";
import { NoAccessScreen } from "./src/screens/NoAccessScreen";
import { CLERK_PUBLISHABLE_KEY, tokenCache } from "./src/lib/clerk";
import {
  SHARE_INTENT_OPTIONS,
  usePendingSharedLink,
  useSharedLinkSave,
  type SharedLink,
} from "./src/lib/share-intent";
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

/**
 * Native splash (app.json → expo-splash-screen plugin: the brand bookmark mark
 * on #ffffff / #0a0a0a) stays up until the first real screen can paint, so the
 * launch never flashes a bare background or a lone spinner.
 *
 * Called at module scope, NOT in a component — by the time a component body
 * runs, auto-hide may already have fired (expo-splash-screen's documented
 * requirement). Failures are swallowed on purpose: the only consequence is the
 * splash hiding early, which must never be a startup crash.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 250 });

/**
 * Hard ceiling on how long the splash may stay up. Anything that wedges startup
 * — Clerk's `isLoaded` never flipping on an instance with the Native API
 * disabled (see the mobile memory notes), a stuck storage read — would otherwise
 * leave the splash on screen forever with no spinner and no error visible behind
 * it. Armed at module scope so it holds even for a tree that never gets far
 * enough to mount the gate.
 */
const SPLASH_MAX_MS = 4_000;
setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), SPLASH_MAX_MS);

/** Hide the splash the moment the app has real content to show. Idempotent: a
 * hide after the ceiling above already fired is a no-op. */
function useHideSplash(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
}

export default function App() {
  return (
    // "Save to Bookmark AI" in the iOS/Android share sheets lands here. The
    // provider has to sit above every other provider (it reads the launch URL /
    // Android intent on mount), so it is the outermost thing in the tree.
    <ShareIntentProvider options={SHARE_INTENT_OPTIONS}>
      <PreferencesProvider>
        <ClerkGate />
      </PreferencesProvider>
    </ShareIntentProvider>
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
  // Captured HERE, above the sign-in/app branch: a share that arrives while
  // signed out is held in memory (never persisted) through the whole sign-in
  // round trip and handed to the Shell the moment a session exists.
  const share = usePendingSharedLink();
  const signedIn = isSignedIn || SKIP_AUTH;
  const clerkReady = isLoaded || SKIP_AUTH;

  useEffect(() => {
    setAuthTokenProvider(() => getToken());
  }, [getToken]);

  // One probe classifies the whole account: ready, still provisioning, or not
  // allowed (see useAccountStatus). Never consulted in the SKIP_AUTH QA session,
  // which has no Clerk user and talks to an open local server.
  const account = useAccountStatus();
  const gated = signedIn && !SKIP_AUTH;

  // The splash covers startup until a real screen can paint: sign-in, the
  // provisioning takeover, the no-access screen, or the tab shell. `checking`
  // only ever holds here for an account we have no evidence about yet (a fresh
  // signup) — and the module-scope ceiling above bounds even that.
  useHideSplash(clerkReady && (!gated || account.status !== "checking"));

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!clerkReady || (gated && account.status === "checking") ? (
        // Behind the native splash in practice; still rendered so a slow start
        // (or the splash ceiling firing first) shows motion rather than a blank.
        <View style={styles.splash}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : !signedIn ? (
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.body}>
          <SignInScreen />
        </SafeAreaView>
      ) : gated && account.status === "provisioning" ? (
        // A brand-new account's own database is still being created. Full-screen
        // on purpose — the Shell is NOT mounted behind it, so when provisioning
        // finishes every screen's first fetch already sees a ready DB.
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.body}>
          <AccountSetupScreen />
        </SafeAreaView>
      ) : gated && account.status === "forbidden" ? (
        // Signed in fine, but this identity isn't allowed to use the API. A
        // dedicated screen, never a generic network error.
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.body}>
          <NoAccessScreen onRecheck={account.recheck} />
        </SafeAreaView>
      ) : (
        <Shell pendingShare={share.pending} onShareConsumed={share.clear} />
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

function Shell({
  pendingShare,
  onShareConsumed,
}: {
  /** A link handed over by the system share sheet, waiting to be saved. */
  pendingShare: SharedLink | null;
  onShareConsumed: () => void;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [filterSheetOpen, setFilterSheetOpen] = useState(INITIAL === "filters");

  // One-shot cross-tab requests (see src/navigation/intents.ts). Screens stay
  // mounted, so a "navigation" is a tab switch plus a request the target screen
  // consumes and clears — no nav library, no route table.
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetUrl, setAddSheetUrl] = useState<string | null>(null);
  const [libraryTag, setLibraryTag] = useState<string | null>(null);
  const [sessionsSegment, setSessionsSegment] = useState<SessionsSegment | null>(null);
  // A counter, not a boolean: tapping Home's search field twice must re-focus
  // the Search field both times.
  const [searchFocus, setSearchFocus] = useState(0);

  // Bumped after a share-sheet save so the already-mounted Home/Library tabs
  // show it without a pull-to-refresh (their own staleness window is 60s).
  const [savedSignal, setSavedSignal] = useState(0);

  // Auto-save the shared link, confirm it in a banner, and fall back to the Add
  // sheet (prefilled) if the API call fails so the link is never lost.
  const share = useSharedLinkSave({
    pending: pendingShare,
    onConsumed: onShareConsumed,
    onSaved: () => setSavedSignal((n) => n + 1),
    onFailed: (link) => {
      setAddSheetUrl(link.url);
      setTab("library");
      setAddSheetOpen(true);
    },
  });

  const navigate = useCallback((target: NavTarget) => {
    setTab(target.tab);
    if (target.tab === "library") {
      if (target.tag !== undefined) setLibraryTag(target.tag);
      if (target.add === true) {
        setAddSheetUrl(null);
        setAddSheetOpen(true);
      }
    } else if (target.tab === "sessions") {
      if (target.segment !== undefined) setSessionsSegment(target.segment);
    } else if (target.tab === "search") {
      if (target.focus === true) setSearchFocus((n) => n + 1);
    }
  }, []);

  // Closing the sheet also drops any share-failure prefill, so the next manual
  // "+" opens on an empty field rather than a link from a past failed share.
  const changeAddSheet = useCallback((open: boolean) => {
    setAddSheetOpen(open);
    if (!open) setAddSheetUrl(null);
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
            <HomeScreen active={tab === "home"} onNavigate={navigate} refreshSignal={savedSignal} />
          </View>
          <View style={[styles.screen, tab !== "library" && styles.hidden]}>
            <LibraryScreen
              active={tab === "library"}
              filterSheetOpen={filterSheetOpen}
              onFilterSheetChange={setFilterSheetOpen}
              addSheetOpen={addSheetOpen}
              onAddSheetChange={changeAddSheet}
              addSheetUrl={addSheetUrl}
              requestedTag={libraryTag}
              onRequestedTagHandled={clearLibraryTag}
              refreshSignal={savedSignal}
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
      {share.notice !== null && (
        <ShareSavedBanner notice={share.notice} onDismiss={share.dismiss} />
      )}
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
