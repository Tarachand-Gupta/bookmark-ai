import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import {
  bookmarkImportProgress,
  bookmarkImportStorageKey,
  createBookmarkImportJob,
  restoreBookmarkImportJob,
  retryFailedBookmarkImports,
  runBookmarkImportJob,
  type BookmarkImportJob,
  type BookmarkImportPreview,
} from "@bookmark-ai/types";
import { useAppTheme } from "../../context/PreferencesContext";
import { useAuth } from "../../lib/auth";
import { CURRENT_DEVICE, getApiUrl } from "../../api";
import {
  applyMobileImport,
  pickBookmarkImportFile,
  previewMobileImport,
} from "../../lib/bookmark-import";
import { ModalSafeArea } from "../../navigation/ModalSafeArea";
import { useContentWidth } from "../../hooks/useContentWidth";

export interface ImportBookmarksSheetProps {
  visible: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export function ImportBookmarksSheet(props: ImportBookmarksSheetProps) {
  const { userId } = useAuth();
  // Replacing the account synchronously replaces every private source/input state.
  return (
    <ImportBookmarksSheetContent key={`${getApiUrl()}:${userId ?? "signed-out"}`} {...props} />
  );
}

function ImportBookmarksSheetContent({ visible, onClose, onImported }: ImportBookmarksSheetProps) {
  const { colors } = useAppTheme();
  const { userId } = useAuth();
  const { inset } = useContentWidth();
  const [preview, setPreview] = useState<BookmarkImportPreview | null>(null);
  const [job, setJob] = useState<BookmarkImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [preserveFolders, setPreserveFolders] = useState(true);
  const [visibleCount, setVisibleCount] = useState(100);
  const [showHelp, setShowHelp] = useState(false);
  const account = useRef(userId);
  account.current = userId;
  const active = useRef(false);
  const pause = useRef(false);
  const generation = useRef(0);
  const origin = getApiUrl();

  useEffect(() => {
    const current = ++generation.current;
    pause.current = true;
    setJob(null);
    setPreview(null);
    setText("");
    setError(null);
    setBusy(false);
    if (!visible || !userId) return;
    void AsyncStorage.getItem(bookmarkImportStorageKey(userId, origin))
      .then((raw) => {
        if (current === generation.current) setJob(restoreBookmarkImportJob(raw, userId, origin));
      })
      .catch(() => {
        if (current === generation.current)
          setError("Saved import progress could not be read. Try opening Import again.");
      });
  }, [visible, userId, origin]);
  useEffect(
    () => () => {
      pause.current = true;
      account.current = null;
      generation.current++;
    },
    [],
  );
  const close = () => {
    pause.current = true;
    onClose();
  };
  const load = async (fromFile: boolean) => {
    if (!userId || busy) return;
    const current = ++generation.current;
    const owner = userId;
    setBusy(true);
    setError(null);
    try {
      const source = fromFile
        ? await pickBookmarkImportFile()
        : {
            name: "Pasted links",
            request: { action: "preview" as const, source: "markdown" as const, content: text },
          };
      if (!source || current !== generation.current || account.current !== owner) return;
      const next = await previewMobileImport(owner, source.request);
      if (current === generation.current && account.current === owner) {
        setPreview(next);
        setSourceName(source.name);
        setVisibleCount(100);
      }
    } catch (failure) {
      if (current === generation.current) setError((failure as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const run = async (next: BookmarkImportJob) => {
    if (active.current || !userId) return;
    const owner = userId;
    const current = generation.current;
    const isCurrent = () => account.current === owner && generation.current === current;
    active.current = true;
    pause.current = false;
    setBusy(true);
    setError(null);
    try {
      const result = await runBookmarkImportJob(next, {
        uuid: Crypto.randomUUID,
        apply: (request) => applyMobileImport(owner, request),
        isCurrentAccount: isCurrent,
        shouldPause: () => pause.current,
        save: (current) =>
          AsyncStorage.setItem(bookmarkImportStorageKey(owner, origin), JSON.stringify(current)),
        changed: (state) => {
          if (isCurrent()) setJob(state);
        },
      });
      if (isCurrent() && result.outcomes.some((item) => item.status === "imported")) onImported?.();
    } finally {
      active.current = false;
      if (isCurrent()) setBusy(false);
    }
  };
  const reset = async () => {
    if (!userId || busy) return;
    try {
      await AsyncStorage.removeItem(bookmarkImportStorageKey(userId, origin));
      setJob(null);
      setPreview(null);
      setText("");
      setError(null);
    } catch {
      setError("Saved import progress could not be cleared. Try again.");
    }
  };
  const counts = job ? bookmarkImportProgress(job) : null;
  const ready = preview ? preview.items.length - preview.existingCount : 0;
  const Action = ({
    title,
    onPress,
    disabled = false,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={{ color: colors.foreground, fontWeight: "600", textAlign: "center" }}>
        {title}
      </Text>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={close}
    >
      <ModalSafeArea backgroundColor={colors.background}>
        <View style={[styles.header, { borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]} accessibilityRole="header">
            Import existing links
          </Text>
          <Action title={busy && job ? "Pause & close" : "Done"} onPress={close} />
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: Math.max(20, inset) }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.copy, { color: colors.mutedForeground }]}>
            Review before saving. Links already in your library stay unchanged.
          </Text>
          {error && (
            <Text accessibilityRole="alert" style={[styles.copy, { color: colors.destructive }]}>
              {error}
            </Text>
          )}
          {!job && !preview && (
            <>
              <Text
                style={[styles.heading, { color: colors.foreground }]}
                accessibilityRole="header"
              >
                Bring a file
              </Text>
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                Choose a bookmarks HTML export, Markdown or plain text from Files. Up to 5 MB and
                5,000 links.
              </Text>
              <Action
                title="Choose file"
                disabled={busy || !userId}
                onPress={() => void load(true)}
              />
              <Action
                title={showHelp ? "Hide export steps" : "How to export browser bookmarks"}
                onPress={() => setShowHelp(!showHelp)}
              />
              {showHelp && (
                <View style={[styles.panel, { borderColor: colors.border }]}>
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    Chrome or Firefox: export bookmarks as HTML from a computer, then put the file
                    in Files or Downloads. For mobile bookmarks, first sync them to that browser on
                    a computer.
                  </Text>
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    Safari: on a Mac, use File → Export Browsing Data to File and select Bookmarks
                    only. Extract the ZIP and choose the bookmarks HTML file. Safari extensions
                    cannot read your iCloud bookmark library.
                  </Text>
                </View>
              )}
              <Text
                style={[styles.heading, { color: colors.foreground }]}
                accessibilityRole="header"
              >
                Links from notes
              </Text>
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                Paste links or Markdown. Only web links are saved; note text and attachments remain
                in the original app.
              </Text>
              <TextInput
                accessibilityLabel="Links or Markdown to import"
                value={text}
                onChangeText={setText}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://example.com"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                editable={!busy}
              />
              <Action
                title="Preview links"
                disabled={!text.trim() || busy || !userId}
                onPress={() => void load(false)}
              />
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                For new links, use your browser's Share button and choose Bookmark AI. You can also
                save a link directly in the app.
              </Text>
            </>
          )}
          {preview && !job && (
            <>
              <Text style={[styles.heading, { color: colors.foreground }]}>{sourceName}</Text>
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.copy, { color: colors.foreground }]}
              >
                {ready} ready · {preview.existingCount} already saved · {preview.duplicateCount}{" "}
                repeated · {preview.invalidCount} invalid
              </Text>
              {preview.warnings.map((warning) => (
                <Text key={warning} style={[styles.copy, { color: colors.mutedForeground }]}>
                  {warning}
                </Text>
              ))}
              {preview.items.some((item) => item.folderPath.length) && (
                <View style={styles.switchRow}>
                  <Text style={[styles.copy, { color: colors.foreground, flex: 1 }]}>
                    {preserveFolders ? "Keep source folders" : "Put new links in Unsorted"}
                  </Text>
                  <Switch
                    accessibilityLabel="Keep source folders"
                    value={preserveFolders}
                    onValueChange={setPreserveFolders}
                  />
                </View>
              )}
              {preview.items.length === 0 && (
                <Text style={[styles.copy, { color: colors.foreground }]}>
                  No usable web links were found. Choose another file or paste HTTP(S) links.
                </Text>
              )}
              {preview.items.slice(0, visibleCount).map((item) => (
                <View key={item.key} style={[styles.row, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.title}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.url}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {item.folderPath.join(" / ") || "Unsorted"} ·{" "}
                    {item.status === "existing" ? "Already saved" : "Ready"}
                  </Text>
                </View>
              ))}
              {visibleCount < preview.items.length && (
                <Action title="Show more" onPress={() => setVisibleCount((count) => count + 100)} />
              )}
              <Action
                title={`Import ${ready} links`}
                disabled={!ready || busy || !userId}
                onPress={() =>
                  userId &&
                  void run(
                    createBookmarkImportJob(preview, {
                      id: Crypto.randomUUID(),
                      accountId: userId,
                      origin,
                      browser: "other",
                      device: CURRENT_DEVICE,
                      preserveFolders,
                    }),
                  )
                }
              />
              <Action
                title="Choose another source"
                disabled={busy}
                onPress={() => setPreview(null)}
              />
            </>
          )}
          {job && counts && (
            <>
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.heading, { color: colors.foreground }]}
              >
                {job.status === "completed"
                  ? counts.failed
                    ? "Import finished with failures"
                    : "Your links are ready"
                  : busy
                    ? "Importing links…"
                    : "Import paused"}
              </Text>
              <Text style={[styles.copy, { color: colors.foreground }]}>
                {counts.imported} imported · {counts.existing} already saved · {counts.failed}{" "}
                failed · {counts.remaining} remaining
              </Text>
              {job.error && (
                <Text
                  accessibilityRole="alert"
                  style={[styles.copy, { color: colors.destructive }]}
                >
                  {job.error}
                </Text>
              )}
              <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                Progress is saved for this account on this device. Done or Back pauses after the
                current batch; reopen Import to resume.
              </Text>
              {job.outcomes
                .filter((item) => item.status === "failed")
                .slice(0, 100)
                .map((item) => (
                  <View key={item.key} style={[styles.row, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.foreground }}>{item.url}</Text>
                    <Text style={{ color: colors.mutedForeground }}>{item.error}</Text>
                  </View>
                ))}
              {!busy && counts.remaining > 0 && (
                <Action title="Resume import" onPress={() => void run(job)} />
              )}
              {!busy && counts.failed > 0 && !job.pending && (
                <Action
                  title={`Retry ${counts.failed} failed`}
                  onPress={() => void run(retryFailedBookmarkImports(job))}
                />
              )}
              {!busy && job.status === "completed" && (
                <>
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    Find a saved title with Search, open a folder, or ask AI about your library.
                  </Text>
                  <Action title="Go to library" onPress={close} />
                  <Action title="Start another import" onPress={() => void reset()} />
                </>
              )}
            </>
          )}
          {busy && (
            <ActivityIndicator
              accessibilityLabel={job ? "Importing links" : "Reading links, nothing saved yet"}
              color={colors.foreground}
            />
          )}
        </ScrollView>
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: "600", flexShrink: 1 },
  content: { gap: 14, paddingTop: 20, paddingBottom: 40 },
  heading: { fontSize: 18, fontWeight: "600" },
  copy: { fontSize: 14, lineHeight: 21 },
  button: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: "center",
  },
  input: { minHeight: 140, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  panel: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 12 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 4 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
