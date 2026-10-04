import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { signInInBrowser } from "../lib/auth";
import { openWebPage, PRIVACY_URL, TERMS_URL } from "../lib/links";

export function SignInScreen() {
  const { colors, radius } = useAppTheme();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function signIn() {
    if(busy)return;setBusy(true);setError("");
    try{await signInInBrowser();}catch{setError("Couldn't finish sign-in. Check your connection and try again.");}finally{setBusy(false);}
  }
  return <ScrollView contentContainerStyle={[styles.root,{backgroundColor:colors.background}]}>
    <View style={[styles.hero,styles.column]}>
      <View style={[styles.mark,{backgroundColor:colors.primary}]}><Symbol name="bookmark.fill" size={30} color={colors.primaryForeground} fallback="B"/></View>
      <Text style={[styles.title,{color:colors.foreground}]}>Bookmark AI</Text>
      <Text style={[styles.subtitle,{color:colors.mutedForeground}]}>Sign in to browse and search your library.</Text>
    </View>
    <View style={[styles.form,styles.column]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Sign in" disabled={busy} onPress={()=>void signIn()} style={({pressed})=>[styles.primaryBtn,{backgroundColor:colors.primary,borderRadius:radius.lg,opacity:busy?0.6:pressed?0.85:1}]}>
        {busy?<ActivityIndicator color={colors.primaryForeground}/>:<Text style={[styles.primaryBtnText,{color:colors.primaryForeground}]}>Sign In</Text>}
      </Pressable>
      <Text style={[styles.subtitle,{color:colors.mutedForeground}]}>Continue securely in your browser.</Text>
      {error&&<Text accessibilityRole="alert" style={[styles.error,{color:colors.destructive}]}>{error}</Text>}
    </View>
    <Text style={[styles.consent,styles.column,{color:colors.mutedForeground}]}>By continuing you agree to the <Text onPress={()=>openWebPage(TERMS_URL)} accessibilityRole="link" style={[styles.consentLink,{color:colors.foreground}]}>Terms of Service</Text> and <Text onPress={()=>openWebPage(PRIVACY_URL)} accessibilityRole="link" style={[styles.consentLink,{color:colors.foreground}]}>Privacy Policy</Text>.</Text>
  </ScrollView>;
}

const AUTH_BUTTON_HEIGHT = 50;
const styles = StyleSheet.create({
  flex: { flex: 1 },
  // `alignItems: "center"` + the children's maxWidth is the iPad story: on a
  // 13" iPad the form would otherwise stretch edge to edge (1,000+ pt wide
  // inputs and a button as wide as the screen). Phones are narrower than the cap,
  // so nothing changes there.
  root: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 32 },
  column: { width: "100%", maxWidth: 440 },
  hero: { alignItems: "center", gap: 8 },
  finishing: { alignItems: "center", gap: 12, paddingVertical: 24 },
  finishingTitle: { fontSize: 17, fontWeight: "600" },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.4 },
  subtitle: { fontSize: 15, textAlign: "center", maxWidth: 280, lineHeight: 20 },
  form: { gap: 14 },
  // The system Apple button needs an explicit width and height (it renders
  // nothing without them) and refuses backgroundColor/borderRadius via style —
  // its colour comes from buttonStyle, its radius from cornerRadius.
  appleBtn: { width: "100%", height: AUTH_BUTTON_HEIGHT },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: AUTH_BUTTON_HEIGHT,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "600" },
  secondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: AUTH_BUTTON_HEIGHT,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: { fontSize: 17, fontWeight: "500" },
  linkText: { fontSize: 15, textAlign: "center" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  input: {
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: StyleSheet.hairlineWidth,
    // Explicit, not a default: iOS leaks codeInput's tracking into any
    // TextInput that doesn't declare its own (see codeInput below).
    letterSpacing: 0,
  },
  codeInput: { textAlign: "center", fontSize: 22, letterSpacing: 6 },
  codeInputEmpty: { fontSize: 17, letterSpacing: 0 },
  error: { fontSize: 14, textAlign: "center", lineHeight: 19 },
  // Pulled up against the form (the root's gap is sized for hero → form) and
  // kept clear of the home indicator by the SafeAreaView around this screen.
  consent: { fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: -12 },
  consentLink: { fontWeight: "600", textDecorationLine: "underline" },
});
