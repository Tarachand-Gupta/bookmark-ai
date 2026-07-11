import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Linking, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { PreferencesProvider, useAppTheme } from "./src/context/PreferencesContext";
import { TabBar, type TabKey } from "./src/navigation/TabBar";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

export default function App() {
  return (
    <PreferencesProvider>
      <SafeAreaProvider>
        <Shell />
      </SafeAreaProvider>
    </PreferencesProvider>
  );
}

// Dev/screenshot affordance: EXPO_PUBLIC_INITIAL_TAB=search|settings|filters
// (inlined at bundle time; unset in normal use).
const INITIAL = process.env.EXPO_PUBLIC_INITIAL_TAB;

function Shell() {
  const { colors, dark } = useAppTheme();
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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
      <StatusBar style={dark ? "light" : "dark"} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: "none" },
});
