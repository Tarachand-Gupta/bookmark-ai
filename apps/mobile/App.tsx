import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { useTheme } from "./src/theme";

export default function App() {
  const { colors } = useTheme();
  return (
    <SafeAreaProvider>
      {/* Bottom edge stays open — the list scrolls under the home indicator. */}
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <LibraryScreen />
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
