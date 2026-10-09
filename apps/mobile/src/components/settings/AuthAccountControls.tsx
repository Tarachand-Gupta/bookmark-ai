import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { listAuthSessions, renameAuthSession, reportUnauthorized, revokeAuthSession, type AuthSession } from "../../api";
import { useAppTheme } from "../../context/PreferencesContext";
import { beginNativeFlow, supabase, useAuth } from "../../lib/auth";
import { displayLabel, profileName, profileNameUpdate } from "../../lib/auth-policy";
import { Group, GroupFootnote, GroupLabel, GroupRow } from "./SettingsGroup";
import { groupSessions, presentSession } from "../../lib/session-presentation";
import { Symbol } from "../Symbol";
import { FontAwesome6 } from "@expo/vector-icons";
import { ModalSafeArea } from "../../navigation/ModalSafeArea";

type Editor = { kind: "profile" | "email" | "password" | "device"; id?: string };
export function AuthAccountControls({ section }: { section: "account" | "devices" }) {
  const { colors, radius } = useAppTheme();
  const { user, signOut } = useAuth();
  const [selected, setSelected] = useState<AuthSession | null>(null);
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
  useEffect(() => { if (section === "devices") void load(); }, [load, section]);
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
    setEditor(null); setValue(""); setEmailCode(""); if (section === "devices") await load();
  });
  const revoke = (session: AuthSession) => Alert.alert("Sign out this device?", `${session.displayName}${session.isCurrent ? " is this device" : " will need to sign in again"}.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out device", style: "destructive", onPress: () => void run(async () => { await revokeAuthSession(session.id); setSelected(null); if (session.isCurrent) reportUnauthorized(); else await load(); }) },
  ]);
  const scopedSignOut = (scope: "others" | "global") => Alert.alert(scope === "others" ? "Sign out other devices?" : "Sign out all devices?", scope === "others" ? "This device will stay signed in." : "You'll need to sign in again on every device.", [
    { text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void run(async () => { await signOut(scope); if (scope === "others") await load(); }) },
  ]);
  const title = editor?.kind === "profile" ? "Display name" : editor?.kind === "email" ? "Change email" : editor?.kind === "password" ? "Change password" : "Rename device";
  const disabled = busy || !value.trim() || (editor?.kind === "password" && value.length < 8) || (emailPending && emailCode.trim().length < 6);
  const groups = groupSessions(sessions);
  const selectedDisplay = selected ? presentSession(selected) : null;
  return <>
    {section === "account" && <><GroupLabel>Profile & security</GroupLabel>
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
    </>}
    {section === "devices" && <>
      <GroupFootnote>See where you’re signed in. Choose a device to rename it or sign it out.</GroupFootnote>
      {([{ key: "apps", title: "Apps & Web", entries: groups.apps }, { key: "extensions", title: "Browser Extensions", entries: groups.extensions }]).map(group => <View key={group.key}>
        <GroupLabel>{`${group.title} · ${group.entries.length}`}</GroupLabel>
        <Group>
          {group.entries.map((session, index) => {
            const display = presentSession(session);
            const browserIcon = session.clientType === "chrome-extension" ? "chrome" : session.clientType === "firefox-extension" ? "firefox-browser" : session.clientType === "safari-extension" ? "safari" : null;
            return <Pressable key={session.id} accessibilityRole="button" accessibilityLabel={`${display.title}, ${display.metadata}${session.isCurrent ? ", This device" : ""}`} onPress={() => setSelected(session)} disabled={busy} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderTopWidth: index ? 0.5 : 0, borderColor: colors.border, backgroundColor: pressed ? colors.muted : colors.card })}>
              {browserIcon ? <FontAwesome6 name={browserIcon} size={22} color={colors.mutedForeground} /> : <Symbol name={display.symbol} size={22} color={colors.mutedForeground} />}
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "500" }}>{display.title}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>{display.metadata}</Text>
                {session.isCurrent && <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>This device</Text>}
              </View>
              <Symbol name="chevron.right" size={14} color={colors.mutedForeground} />
            </Pressable>;
          })}
          {!group.entries.length && <GroupRow first label={loading ? "Loading…" : group.key === "apps" ? "No apps or websites" : "No browser extensions"} />}
        </Group>
      </View>)}
      <GroupLabel>Manage sign-ins</GroupLabel>
      <Group>
        <GroupRow first symbol="arrow.clockwise" label={loading ? "Refreshing…" : "Refresh devices"} onPress={loading || busy ? undefined : () => void load()} />
        <GroupRow label="Sign out other devices" destructive onPress={busy ? undefined : () => scopedSignOut("others")} />
        <GroupRow label="Sign out all devices" destructive onPress={busy ? undefined : () => scopedSignOut("global")} />
      </Group>
      <GroupFootnote>Separate sign-ins stay separate, even when their names match. Signing out a device ends the apps using that sign-in.</GroupFootnote>
    </>}
    <Modal visible={selected !== null} animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => { if (!busy) setSelected(null); }}>
      <ModalSafeArea backgroundColor={colors.background}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderColor: colors.border }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Devices" disabled={busy} onPress={() => setSelected(null)} hitSlop={12}><Symbol name="chevron.left" size={21} color={colors.foreground} /></Pressable>
          <Text style={{ color: colors.foreground, flex: 1, fontSize: 17, fontWeight: "600" }}>Device details</Text>
          <Pressable accessibilityRole="button" onPress={() => setSelected(null)} disabled={busy} hitSlop={12}><Text style={{ color: colors.foreground, fontSize: 17 }}>Done</Text></Pressable>
        </View>
        {selected && selectedDisplay && <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "600", marginTop: 16 }}>{selectedDisplay.title}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 15, lineHeight: 22 }}>{selectedDisplay.metadata}</Text>
          {selected.isCurrent && <Text style={{ color: colors.primary, fontWeight: "600" }}>This device</Text>}
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Last active {selected.lastActiveAt && Number.isFinite(Date.parse(selected.lastActiveAt)) ? new Date(selected.lastActiveAt).toLocaleString() : "recently"}</Text>
          <Group>
            <GroupRow first symbol="square.and.pencil" label="Rename device" chevron onPress={busy ? undefined : () => { setSelected(null); open({ kind: "device", id: selected.id }, selected.displayName); }} />
            <GroupRow symbol="rectangle.portrait.and.arrow.right" label="Sign out device" destructive onPress={busy ? undefined : () => revoke(selected)} />
          </Group>
          <GroupFootnote>Renaming changes only this label. Your bookmarks stay saved when a device signs out.</GroupFootnote>
          {busy && <ActivityIndicator color={colors.primary} />}
          {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
        </ScrollView>}
      </ModalSafeArea>
    </Modal>
    {((section === "devices" && loading) || busy) && <ActivityIndicator color={colors.primary} />}
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
