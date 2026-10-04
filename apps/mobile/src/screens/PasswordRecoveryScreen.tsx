import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useAppTheme } from "../context/PreferencesContext";
import { supabase, useAuth } from "../lib/auth";

export function PasswordRecoveryScreen() {
  const { colors, radius } = useAppTheme();
  const { finishRecovery, signOut } = useAuth();
  const [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { error: failure } = await supabase.auth.updateUser({ password });
      if (failure) throw failure;
      setPassword(""); finishRecovery();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't update your password. Please retry."); }
    finally { setBusy(false); }
  };
  return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 28, backgroundColor: colors.background }}>
    <View style={{ width: "100%", maxWidth: 440, gap: 20 }}>
      <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "600" }}>Choose a new password</Text>
      <TextInput accessibilityLabel="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password-new" textContentType="newPassword" placeholder="At least 8 characters" placeholderTextColor={colors.mutedForeground} style={{ color: colors.foreground, backgroundColor: colors.card, padding: 16, borderRadius: radius.lg }} />
      <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy || password.length < 8}><Text style={{ color: colors.primary }}>Update password</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void signOut().catch(() => setError("Reconnect to cancel this recovery session."))} disabled={busy}><Text style={{ color: colors.mutedForeground }}>Cancel and sign out</Text></Pressable>
      {busy && <ActivityIndicator color={colors.primary} />}
      {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    </View>
  </View>;
}
