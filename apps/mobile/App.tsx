import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Linking, LogBox, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { setAuthTokenProvider } from "./src/api";
import { PreferencesProvider, useAppTheme } from "./src/context/PreferencesContext";
import { CLERK_PUBLISHABLE_KEY, tokenCache } from "./src/lib/clerk";
import { TabBar, type TabKey } from "./src/navigation/TabBar";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { SignInScreen } from "./src/screens/SignInScreen";

// Expected while on the dev Clerk instance (same note silenced in the
// extension popup); a production instance removes it for real.
LogBox.ignoreLogs([/Clerk has been loaded with development keys/]);

export default function App() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <PreferencesProvider>
        <SafeAreaProvider>
          <Gate />
        </SafeAreaProvider>
      </PreferencesProvider>
    </ClerkProvider>
  );
}

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
      {!isLoaded ? (
        <View style={styles.splash}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : !isSignedIn ? (
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

// Dev/screenshot affordance: EXPO_PUBLIC_INITIAL_TAB=search|settings|filters
// (inlined at bundle time; unset in normal use).
const INITIAL = process.env.EXPO_PUBLIC_INITIAL_TAB;

function Shell() {
  const [tab, setTab] = useState<TabKey>(
    INITIAL === "search" || INITIAL === "settings" ? INITIAL : "library",
  );
  const [filterSheetOpen, setFilterSheetOpen] = useState(INITIAL === "filters");

  // Deep links: bookmarkai://tab/<library|search|settings>, bookmarkai://filters
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const match = /(?:tab\/)?(library|search|settings|filters)\/?$/.exec(url);
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

  // Screens stay mounted so tab switches keep scroll position and state.
  return (
    <>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.body}>
        <View style={[styles.screen, tab !== "library" && styles.hidden]}>
          <LibraryScreen filterSheetOpen={filterSheetOpen} onFilterSheetChange={setFilterSheetOpen} />
        </View>
        <View style={[styles.screen, tab !== "search" && styles.hidden]}>
          <SearchScreen />
        </View>
        <View style={[styles.screen, tab !== "settings" && styles.hidden]}>
          <SettingsScreen />
        </View>
      </SafeAreaView>
      <TabBar tab={tab} onChange={setTab} />
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
