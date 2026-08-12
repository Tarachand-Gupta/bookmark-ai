import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Linking, LogBox, StyleSheet, View } from "react-native";
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
import { LaunchScreen } from "./src/components/LaunchScreen";
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
import { SettingsPresentation } from "./src/navigation/SettingsPresentation";
import { TabBar, type TabKey } from "./src/navigation/TabBar";
import { ChatScreen } from "./src/screens/ChatScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { SignInScreen } from "./src/screens/SignInScreen";

// Only fires when the dev Clerk instance is used for local development (the
// production default doesn't emit it); silenced to keep the log clean.
LogBox.ignoreLogs([/Clerk has been loaded with development keys/]);

/**
 * Native splash (app.json → expo-splash-screen plugin: the brand bookmark mark
 * on #ffffff / #0a0a0a) stays up until the app paints its OWN first frame — see
 * useHideSplashOnFirstPaint below and LaunchScreen, its pixel twin.
 *
 * Called at module scope, NOT in a component — by the time a component body
 * runs, auto-hide may already have fired (expo-splash-screen's documented
 * requirement). Failures are swallowed on purpose: the only consequence is the
 * splash hiding early, which must never be a startup crash.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 250 });

/**
 * Hard ceiling on how long the splash may stay up, armed when this module is
 * EVALUATED — i.e. once the JS bundle is already running, with the native splash
 * having covered process start for free. React's first commit follows within a
 * few dozen ms, so this only ever fires when the tree itself never paints (a
 * throw during render, a provider that wedges). It is not the normal path: the
 * splash is dismissed on the first painted frame, so a low ceiling can't cause
 * a bare-background flash the way a pre-JS timer would.
 */
const SPLASH_MAX_MS = 1_500;
setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), SPLASH_MAX_MS);

/**
 * Dismiss the native splash on the first frame the app can paint CORRECTLY —
 * i.e. once the persisted theme has been read (`hydrated`, a single AsyncStorage
 * round trip: ~250ms measured on a cold simulator start). What paints then is
 * LaunchScreen, an identical mark on an identical background, so nothing visibly
 * changes at the handoff except the spinner that starts moving.
 *
 * It used to wait for Clerk's `isLoaded` — a cold-start network round trip to
 * FAPI (+1377ms measured against production on a warm simulator, seconds on a
 * phone) — and, behind that, the account probe, so the launch sat on a frozen
 * image with no sign of life. Waiting for storage but NOT for the network is the
 * whole change: the theme can't flip after the handoff, and nothing on the far
 * side of a network call can freeze the launch again.
 */
function useHideSplashOnFirstPaint(hydrated: boolean): void {
  useEffect(() => {
    if (!hydrated) return;
    // Two frames deep: an effect runs after the commit but BEFORE that commit
    // reaches the screen, so hiding synchronously here can expose one bare
    // frame between the splash and our own background.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => void SplashScreen.hideAsync().catch(() => undefined)),
    );
  }, [hydrated]);
}

/**
 * ClerkProvider mounts ABOVE PreferencesProvider deliberately: it kicks off
 * Clerk's cold-start FAPI round trip (environment + client) the moment the tree
 * mounts, so that network time overlaps the AsyncStorage read of persisted
 * preferences instead of queueing behind it. It takes this build's publishable
 * key once (CLERK_PUBLISHABLE_KEY is a build-time constant derived from
 * SERVER_TARGET — there is no in-app server switch) and never remounts.
 */
export default function App() {
  return (
    // "Save to Bookmark AI" in the iOS/Android share sheets lands here. The
    // provider has to sit above every other provider (it reads the launch URL /
    // Android intent on mount), so it is the outermost thing in the tree.
    <ShareIntentProvider options={SHARE_INTENT_OPTIONS}>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
        <PreferencesProvider>
          {/* initialMetrics avoids the Android first-frame zero-inset flash
              (Settings title rendered under the status bar on first mount). */}
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <Gate />
          </SafeAreaProvider>
        </PreferencesProvider>
      </ClerkProvider>
    </ShareIntentProvider>
  );
}

// Dev-only QA affordance: lets headless test agents past the sign-in gate to
// exercise the UI against the open local server. Ignored in release builds.
const SKIP_AUTH = __DEV__ && process.env.EXPO_PUBLIC_SKIP_AUTH === "1";

/** Auth gate: the launch scaffold while storage/Clerk are still settling,
 * sign-in when there is no session, the app otherwise. Also feeds the session
 * token to the API client. */
function Gate() {
  const { colors, dark } = useAppTheme();
  const { hydrated } = usePreferences();
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

  // The native splash goes away on our first correctly-themed frame — which is
  // the LaunchScreen below, its pixel twin — never waiting on the network.
  useHideSplashOnFirstPaint(hydrated);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!hydrated || !clerkReady || (gated && account.status === "checking") ? (
        // Still settling: the persisted theme/view read, Clerk restoring the
        // session, and (for an account we have no evidence about yet — a fresh
        // signup) the account probe. Renders the splash's own mark plus a
        // spinner, so this is a seamless continuation of the launch image
        // rather than a second, emptier loading state.
        <LaunchScreen />
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

// Dev/screenshot affordance: EXPO_PUBLIC_INITIAL_TAB=home|library|sessions|search|chat|settings|filters
// (inlined at bundle time; unset in normal use → Home, the landing tab).
const INITIAL = process.env.EXPO_PUBLIC_INITIAL_TAB;

function initialTab(): TabKey {
  if (
    INITIAL === "home" ||
    INITIAL === "library" ||
    INITIAL === "sessions" ||
    INITIAL === "search" ||
    INITIAL === "chat"
  ) {
    return INITIAL;
  }
  // EXPO_PUBLIC_INITIAL_TAB=filters opens the Library with its sheet up, and
  // =settings opens Home with the Settings presentation over it (Settings is no
  // longer a tab — see initialSettingsOpen below).
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
  // Settings is a presentation, not a tab: one shell-level flag, opened from
  // Home's title row and from the live-off empty state.
  const [settingsOpen, setSettingsOpen] = useState(INITIAL === "settings");

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
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Deep links: bookmarkai://tab/<home|library|sessions|search|chat|settings>, bookmarkai://filters
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const match = /(?:tab\/)?(home|library|sessions|search|chat|settings|filters)\/?$/.exec(url);
      if (!match) return;
      if (match[1] === "filters") {
        setTab("library");
        setFilterSheetOpen(true);
      } else if (match[1] === "settings") {
        // Kept as a link target even though it lost its tab: it opens the
        // presentation over whatever tab is showing.
        setSettingsOpen(true);
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
            <HomeScreen
              active={tab === "home"}
              onNavigate={navigate}
              onOpenSettings={openSettings}
              refreshSignal={savedSignal}
            />
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
              onOpenSettings={openSettings}
              requestedSegment={sessionsSegment}
              onRequestedSegmentHandled={clearSessionsSegment}
            />
          </View>
          <View style={[styles.screen, tab !== "search" && styles.hidden]}>
            <SearchScreen focusRequest={searchFocus} />
          </View>
          <View style={[styles.screen, tab !== "chat" && styles.hidden]}>
            {/* `active` gates the history fetch: every screen is mounted from
                launch, so Ask AI must not hit /api/chat/conversations before the
                tab is ever opened. */}
            <ChatScreen active={tab === "chat"} />
          </View>
        </SafeAreaView>
      </BlurTargetView>
      <TabBar tab={tab} onChange={setTab} blurTarget={blurTargetRef} />
      {/* A native full-screen modal, so it covers the floating tab bar too. */}
      <SettingsPresentation visible={settingsOpen} onClose={closeSettings} />
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
});
