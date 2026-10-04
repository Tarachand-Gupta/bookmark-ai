import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";
import { supabase, useAuth } from "../lib/auth";

export function MfaChallengeScreen() {
  const { colors, radius } = useAppTheme();
  const { mfaStatus, retryMFA, verifyMFA, cancelMFA } = useAuth();
  const [factors, setFactors] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState(""), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let active = true;
    setCode(""); setError(null); setFactors([]); setSelected("");
    if (mfaStatus === "required") void supabase.auth.mfa.listFactors().then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) { setError("Couldn't load your authenticator. Retry when connected."); return; }
      const next = data.totp.map((factor) => ({ id: factor.id, name: factor.friendly_name || "Authenticator" }));
      setFactors(next); setSelected(next[0]?.id ?? "");
      if (!next.length) setError("No supported authenticator is available. Sign out and manage your factors on the web.");
    }).catch(() => { if (active) setError("Couldn't load your authenticator. Retry when connected."); });
    return () => { active = false; };
  }, [mfaStatus]);
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Verification couldn't finish. Try again."); }
    finally { running.current = false; setBusy(false); }
  };
  return <View style={{ flex: 1, justifyContent: "center", padding: 28 }}>
    <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", gap: 20 }}>
      <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "600" }}>
        {mfaStatus === "required" ? "Verify your authenticator" : "Checking sign-in"}
      </Text>
      {mfaStatus === "checking" && <ActivityIndicator color={colors.primary} />}
      {mfaStatus === "unavailable" && <Text accessibilityRole="alert" style={{ color: colors.foreground }}>Sign-in verification is temporarily unavailable. Your saved credentials are preserved. Reconnect and retry.</Text>}
      {mfaStatus === "required" && <>
        <Text style={{ color: colors.mutedForeground }}>Enter the six-digit code from your authenticator app to open your library.</Text>
        {factors.length > 1 && factors.map((factor) => <Pressable key={factor.id} accessibilityRole="radio" accessibilityState={{ selected: selected === factor.id }} disabled={busy} onPress={() => setSelected(factor.id)}><Text style={{ color: colors.primary }}>{factor.name}{selected === factor.id ? " · Selected" : ""}</Text></Pressable>)}
        <TextInput accessibilityLabel="Authenticator code" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} editable={!busy} placeholder="6-digit code" placeholderTextColor={colors.mutedForeground} style={{ color: colors.foreground, backgroundColor: colors.card, padding: 16, borderRadius: radius.lg }} />
        <Pressable accessibilityRole="button" disabled={busy || !selected || code.length !== 6} onPress={() => void run(() => verifyMFA(selected, code))}><Text style={{ color: colors.primary }}>Verify</Text></Pressable>
      </>}
      {busy && <ActivityIndicator color={colors.primary} />}
      {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={retryMFA}><Text style={{ color: colors.primary }}>Retry verification</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(cancelMFA)}><Text style={{ color: colors.mutedForeground }}>Cancel and sign out</Text></Pressable>
    </View>
  </View>;
}
