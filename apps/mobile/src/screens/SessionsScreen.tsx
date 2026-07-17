import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { LiveDevice, LiveWindow, Session } from "@bookmark-ai/types";
import { createSession } from "../api";
import { LiveDeviceSection } from "../components/LiveDeviceSection";
import { LiveEmptyState } from "../components/LiveEmptyState";
import { SegmentedControl } from "../components/SegmentedControl";
import { SessionCard } from "../components/SessionCard";
import { Symbol } from "../components/Symbol";
import { useAppTheme } from "../context/PreferencesContext";
import { useLiveDevices, type SessionsSegment } from "../hooks/useLiveDevices";
import { useSessions } from "../hooks/useSessions";
import { ageLabel, deviceDisplayLabel, isStale } from "../lib/live";
import { useTabBarClearance, useTabBarScroll } from "../navigation/TabBar";

/** Sessions tab. Two segments (Saved default, §5.6): saved snapshots, and the
 * live device → window → tab view of every browser currently mirroring its open
 * tabs. Tap a saved/live tab to open it; save one live window as a session. */
export function SessionsScreen({
  active,
  onOpenSettings,
}: {
  /** Sessions is the foreground tab — one of the three polling gates (§4.7). */
  active: boolean;
  onOpenSettings: () => void;
}) {
  const { colors } = useAppTheme();
  const tabBarClearance = useTabBarClearance();
  const onScroll = useTabBarScroll();

  const [segment, setSegment] = useState<SessionsSegment>("saved");
  const [expandedWindows, setExpandedWindows] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const saved = useSessions();

  const windowKey = (deviceId: string, windowId: number) => `${deviceId}:${windowId}`;

  const live = useLiveDevices({
    active,
    segment,
    // Any expanded window tightens the poll to a few seconds; nothing expanded
    // keeps it slow. Stale keys are pruned below, so a vanished device can't pin
    // the fast cadence on.
    expanded: expandedWindows.size > 0,
  });

  // Drop expansion keys whose window or device is gone, keeping `expanded` honest.
  useEffect(() => {
    setExpandedWindows((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set<string>();
      for (const d of live.devices) {
        for (const w of d.windows) present.add(windowKey(d.deviceId, w.windowId));
      }
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (present.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [live.devices]);

  const toggleWindow = (deviceId: string, windowId: number) => {
    const key = windowKey(deviceId, windowId);
    setExpandedWindows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    live.ping();
  };

  const saveWindow = async (device: LiveDevice, win: LiveWindow, windowNumber: number) => {
    const tabs = win.tabs.map((t) => ({
      url: t.url,
      title: t.title,
      favIconUrl: t.favIconUrl,
      windowId: win.windowId,
    }));
    if (tabs.length === 0) {
      Alert.alert("Nothing to save", "This window has no tabs.");
      return;
    }
    setSavingKey(windowKey(device.deviceId, win.windowId));
    try {
      await createSession({
        name: `${deviceDisplayLabel(device)} · Window ${windowNumber}`,
        tabs,
        browser: device.browser,
        device: device.device,
        savedAt: new Date().toISOString(),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      saved.refresh(); // pull the new session into the Saved list
      setSegment("saved"); // …and land the user on it
    } catch (err) {
      Alert.alert("Could not save", err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  };

  const requestSaveWindow = (device: LiveDevice, win: LiveWindow, windowNumber: number) => {
    if (isStale(device.lastSeenAgeSeconds)) {
      Alert.alert(
        "Save an older window?",
        `This window was last seen ${ageLabel(device.lastSeenAgeSeconds)}. Its tabs may have changed since. Save it anyway?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save", onPress: () => void saveWindow(device, win, windowNumber) },
        ],
      );
    } else {
      void saveWindow(device, win, windowNumber);
    }
  };

  const confirmDelete = (session: Session) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Delete session?",
      `"${session.name || "Untitled session"}" (${session.tabCount} tabs) will be removed everywhere.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            saved.remove(session.id).catch((err: unknown) => {
              Alert.alert("Could not delete", err instanceof Error ? err.message : String(err));
            });
          },
        },
      ],
    );
  };

  const savedLabel =
    saved.loading && saved.sessions.length === 0 ? "Saved" : `Saved · ${saved.sessions.length}`;
  const liveLabel = live.loaded ? `Ongoing · ${live.devices.length}` : "Ongoing";

  const savedEmpty = saved.loading ? (
    <ActivityIndicator style={styles.empty} color={colors.mutedForeground} />
  ) : (
    <View style={styles.empty}>
      <Symbol name="square.stack" size={28} color={colors.mutedForeground} fallback="▣" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {saved.error ? "Could not load" : "No saved sessions yet"}
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        {saved.error ??
          "A saved session is a snapshot — the tabs stay here after the window closes. Save one from the extension, or from an open window."}
      </Text>
    </View>
  );

  const liveEmpty = live.provisioning ? (
    <LiveEmptyState kind="provisioning" />
  ) : !live.loaded && !live.error ? (
    // Never assume enabled before the server answers (§4.9 hydration) — show a
    // spinner rather than flashing the "off" state on the first frame.
    <ActivityIndicator style={styles.empty} color={colors.mutedForeground} />
  ) : live.error && !live.loaded ? (
    <LiveEmptyState kind="error" message={live.error} onRetry={live.refresh} />
  ) : !live.enabled ? (
    <LiveEmptyState kind="off" onOpenSettings={onOpenSettings} />
  ) : (
    <LiveEmptyState kind="no-device" />
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.largeTitle, { color: colors.foreground }]}>Sessions</Text>
        <SegmentedControl
          segments={[
            { value: "saved", label: savedLabel },
            { value: "ongoing", label: liveLabel },
          ]}
          value={segment}
          onChange={setSegment}
        />
        {segment === "ongoing" && live.paused && live.devices.length > 0 && (
          <Text style={[styles.paused, { color: colors.mutedForeground }]}>
            Paused — pull to refresh
          </Text>
        )}
      </View>

      {segment === "saved" ? (
        <FlatList
          style={styles.list}
          data={saved.sessions}
          keyExtractor={(s) => s.id}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl
              refreshing={saved.refreshing}
              onRefresh={saved.refresh}
              tintColor={colors.mutedForeground}
            />
          }
          ListEmptyComponent={savedEmpty}
          renderItem={({ item }) => (
            <SessionCard session={item} onLongPressDelete={() => confirmDelete(item)} />
          )}
        />
      ) : (
        <FlatList
          style={styles.list}
          data={live.devices}
          keyExtractor={(d) => d.deviceId}
          onScroll={onScroll}
          onScrollBeginDrag={live.ping}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl
              refreshing={live.refreshing}
              onRefresh={live.refresh}
              tintColor={colors.mutedForeground}
            />
          }
          ListEmptyComponent={liveEmpty}
          renderItem={({ item: device }) => (
            <LiveDeviceSection
              device={device}
              isWindowExpanded={(windowId) =>
                expandedWindows.has(windowKey(device.deviceId, windowId))
              }
              onToggleWindow={(windowId) => toggleWindow(device.deviceId, windowId)}
              savingKey={savingKey}
              onSaveWindow={(win, windowNumber) => requestSaveWindow(device, win, windowNumber)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  header: { gap: 10, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 20 },
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2 },
  paused: { fontSize: 13 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 72, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyBody: { fontSize: 15, maxWidth: 320, textAlign: "center", lineHeight: 20 },
});
