import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { listAuthSessions, renameAuthSession, reportUnauthorized, revokeAuthSession, type AuthSession } from "../../api";
import { useAppTheme } from "../../context/PreferencesContext";
import { beginNativeFlow, supabase, useAuth } from "../../lib/auth";
import { displayLabel, profileName, profileNameUpdate } from "../../lib/auth-policy";
import { Group, GroupFootnote, GroupLabel, GroupRow } from "./SettingsGroup";

type Editor = { kind: "profile" | "email" | "password" | "device"; id?: string };
export function AuthAccountControls() {
  const { colors, radius } = useAppTheme();
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<AuthSession[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [editor, setEditor] = useState<Editor | null>(null);
  const [value, setValue] = useState(""), [emailCode, setEmailCode] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const running = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const result = await listAuthSessions(); setSessions(result.sessions); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't load signed-in devices."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = (next: Editor, initial = "") => { setValue(initial); setEmailCode(""); setEmailPending(false); setError(null); setEditor(next); };
  const close = () => { if (busy) return; setEditor(null); setValue(""); setEmailCode(""); setEmailPending(false); };
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null);
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't complete this change. Please retry."); }
    finally { running.current = false; setBusy(false); }
  };
  const save = () => run(async () => {
    if (!editor) return;
    if (editor.kind === "device") await renameAuthSession(editor.id!, displayLabel(value, "Mobile device"));
    else if (editor.kind === "email") {
      if (emailPending) {
        const { error: failure } = await supabase.auth.verifyOtp({ email: value.trim(), token: emailCode.trim(), type: "email_change" });
        if (failure) throw failure;
      } else {
        const redirect = await beginNativeFlow("email-change");
        const { error: failure } = await supabase.auth.updateUser({ email: value.trim() }, { emailRedirectTo: redirect });
        if (failure) throw failure;
        setEmailPending(true);
        Alert.alert("Confirm email change", "Check both email addresses for the confirmation links. If an email includes a code, you can enter it here.");
        return;
      }
    } else {
      const attributes = editor.kind === "profile" ? { data: profileNameUpdate(value) } : { password: value };
      const { error: failure } = await supabase.auth.updateUser(attributes);
      if (failure) throw failure;
    }
    setEditor(null); setValue(""); setEmailCode(""); await load();
  });
  const revoke = (session: AuthSession) => Alert.alert("Sign out this device?", `${session.displayName}${session.isCurrent ? " is this device" : " will need to sign in again"}.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out device", style: "destructive", onPress: () => void run(async () => { await revokeAuthSession(session.id); if (session.isCurrent) reportUnauthorized(); else await load(); }) },
  ]);
  const scopedSignOut = (scope: "others" | "global") => Alert.alert(scope === "others" ? "Sign out other devices?" : "Sign out all devices?", scope === "others" ? "This device will stay signed in." : "You'll need to sign in again on every device.", [
    { text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void run(async () => { await signOut(scope); if (scope === "others") await load(); }) },
  ]);
  const title = editor?.kind === "profile" ? "Display name" : editor?.kind === "email" ? "Change email" : editor?.kind === "password" ? "Change password" : "Rename device";
  const disabled = busy || !value.trim() || (editor?.kind === "password" && value.length < 8) || (emailPending && emailCode.trim().length < 6);
  return <>
    <GroupLabel>Profile & security</GroupLabel>
    <Group>
      <GroupRow first label="Display name" onPress={() => open({ kind: "profile" }, profileName(user?.user_metadata))} chevron />
      <GroupRow label="Change email" onPress={() => open({ kind: "email" }, user?.email ?? "")} chevron />
      <GroupRow label="Change password" onPress={() => open({ kind: "password" })} chevron />
      <GroupRow label="Send password recovery email" onPress={() => void run(async () => {
        if (!user?.email) throw new Error("This account has no recovery email.");
        const redirectTo = await beginNativeFlow("recovery");
        const { error: failure } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo });
        if (failure) throw failure;
        Alert.alert("Recovery email sent", "Open the recovery link on this device to choose a new password.");
      })} />
    </Group>
    <GroupLabel>Signed-in devices</GroupLabel>
    <Group>
      {sessions.map((session, index) => <View key={session.id}>
        <GroupRow first={index === 0} label={`${session.displayName}${session.isCurrent ? " · This device" : ""}`} detail={[session.clientType, session.os].filter(Boolean).join(" · ")} onPress={() => open({ kind: "device", id: session.id }, session.displayName)} chevron />
        <View style={{ flexDirection: "row", gap: 20, paddingHorizontal: 20, paddingBottom: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${session.displayName}`} onPress={() => open({ kind: "device", id: session.id }, session.displayName)} disabled={busy}><Text style={{ color: colors.primary }}>Rename</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Sign out ${session.displayName}`} onPress={() => revoke(session)} disabled={busy}><Text style={{ color: colors.destructive }}>Sign out device</Text></Pressable>
        </View>
      </View>)}
      <GroupRow first={!sessions.length} label={loading ? "Loading devices…" : "Refresh devices"} onPress={() => void load()} />
      <GroupRow label="Sign out other devices" destructive onPress={() => scopedSignOut("others")} />
      <GroupRow label="Sign out all devices" destructive onPress={() => scopedSignOut("global")} />
    </Group>
    <GroupFootnote>Device names are labels you can edit. Signing out a device ends its sign-in on every app using that session.</GroupFootnote>
    {(loading || busy) && <ActivityIndicator color={colors.primary} />}
    {error && !editor && <Text accessibilityRole="alert" style={{ color: colors.destructive, padding: 14 }}>{error}</Text>}
    <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" }}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ width: "100%", maxWidth: 440, maxHeight: "80%", backgroundColor: colors.card, borderRadius: radius.lg }} contentContainerStyle={{ padding: 24, gap: 20 }}>
          <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "600" }}>{title}</Text>
          <TextInput accessibilityLabel={title} value={value} onChangeText={setValue} editable={!busy && !emailPending} autoCapitalize="none" autoCorrect={false} secureTextEntry={editor?.kind === "password"} autoComplete={editor?.kind === "password" ? "password-new" : editor?.kind === "email" ? "email" : "off"} keyboardType={editor?.kind === "email" ? "email-address" : "default"} style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, padding: 14, borderRadius: radius.lg }} />
          {emailPending && <TextInput accessibilityLabel="Email change code" value={emailCode} onChangeText={setEmailCode} placeholder="Confirmation code" placeholderTextColor={colors.mutedForeground} autoComplete="one-time-code" keyboardType="number-pad" style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, padding: 14 }} />}
          <Pressable accessibilityRole="button" onPress={() => void save()} disabled={disabled}><Text style={{ color: colors.primary, opacity: disabled ? 0.5 : 1 }}>{emailPending ? "Verify email" : "Save"}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={close} disabled={busy}><Text style={{ color: colors.mutedForeground }}>Cancel</Text></Pressable>
          {busy && <ActivityIndicator color={colors.primary} />}
          {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
        </ScrollView>
      </View>
    </Modal>
  </>;
}
