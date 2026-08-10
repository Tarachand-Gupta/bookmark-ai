"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import {
  AlertTriangle,
  Database,
  Download,
  Loader2,
  Plug,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import type { AiModel, AiProvider, AiUsage } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteAccount,
  exportData,
  fetchAiModels,
  getSettings,
  importData,
  updateSettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { AiCreditsCallout } from "./ai-credits-meter";
import { DevicesSection } from "./devices-settings";
import { FEATURE_ICONS } from "./feature-icons";
import { McpSection } from "./mcp-settings";
import { SyncSection } from "./sync-settings";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section to open on. Defaults to "ai"; the Ongoing empty state opens "devices". */
  initialSection?: SectionId;
}

/** Sections in the settings modal, in rail order. */
const SECTIONS = [
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "data", label: "Data", icon: Database },
  { id: "sync", label: "Sync", icon: FEATURE_ICONS.bookmarks },
  { id: "devices", label: "Live sessions", icon: FEATURE_ICONS.live },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "account", label: "Account", icon: UserRound },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

/** All valid section ids — used to validate the `?settings=<id>` deep link. */
export const SECTION_IDS = SECTIONS.map((s) => s.id) as SectionId[];

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: "google", label: "Gemini (Google)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
];

/**
 * Settings modal. A left rail selects a section (only "AI" today); the AI pane
 * configures the chat agent's provider, API key, and default model. "Test
 * connection & get models" validates the key by listing models; Save persists.
 */
export function SettingsDialog({ open, onOpenChange, initialSection }: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>("ai");
  // Read at open time only, so re-renders that change the prop don't yank the
  // user off the section they navigated to.
  const initialSectionRef = useRef(initialSection);
  initialSectionRef.current = initialSection;
  const railRef = useRef<HTMLUListElement>(null);

  // Loaded/edited AI settings.
  const [provider, setProvider] = useState<AiProvider>("google");
  const [loadedProvider, setLoadedProvider] = useState<AiProvider>("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  // The free-tier weekly meter, rendered above the provider form (see the AI
  // pane): free credits are the default path, so they lead here too.
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);

  // Async status.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // (Re)load current settings whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSection(initialSectionRef.current ?? "ai");
    setLoading(true);
    setLoadError(null);
    setTestMsg(null);
    setTestError(null);
    setSaveMsg(null);
    setSaveError(null);
    setApiKeyInput("");
    getSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setProvider(settings.provider);
        setLoadedProvider(settings.provider);
        setBaseUrl(settings.baseUrl ?? "");
        setModel(settings.model ?? "");
        // Seed the select with the saved model so it shows before any test.
        setModels(settings.model ? [{ id: settings.model, label: settings.model }] : []);
        setApiKeySet(settings.apiKeySet);
        setApiKeyLast4(settings.apiKeyLast4);
        setAiUsage(settings.aiUsage);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // MOBILE: keep the ACTIVE section chip on screen. The rail is one horizontally
  // scrollable strip on narrow screens, and every deep link that opens the dialog
  // straight onto a later section (?settings=mcp, the sidebar's MCP row, the MCP
  // promo CTA) left the strip parked at scrollLeft 0 — so the selected chip sat
  // off-screen to the right and the visible chips all looked unselected, reading
  // as "nothing is selected" on top of a section the user didn't ask for.
  // Runs on open AND on every section change (including clicks, which is how a
  // chip half-off the right edge finishes scrolling itself into view).
  // `block: "nearest"` keeps this from scrolling the dialog vertically; the strip
  // is the only scrollable ancestor on the inline axis, so nothing else moves.
  useEffect(() => {
    if (!open) return;
    railRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open, section]);

  // A stored key belongs to the saved provider; if the user switches provider,
  // the "Saved (••••…)" hint no longer applies.
  const showSavedHint = apiKeySet && provider === loadedProvider;
  const hasKeySource = apiKeyInput.trim().length > 0 || showSavedHint;
  const customNeedsUrl = provider === "custom" && !baseUrl.trim();

  const changeProvider = (value: string) => {
    setProvider(value as AiProvider);
    // Models (and any selection) are provider-specific — reset on switch.
    setModels([]);
    setModel("");
    setTestMsg(null);
    setTestError(null);
    setSaveMsg(null);
  };

  const test = async () => {
    setTesting(true);
    setTestMsg(null);
    setTestError(null);
    try {
      const typed = apiKeyInput.trim();
      const { models: found } = await fetchAiModels({
        provider,
        apiKey: typed || undefined,
        baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
      });
      // Keep a previously-selected model visible even if it's not in the list.
      const merged =
        model && !found.some((m) => m.id === model)
          ? [{ id: model, label: model }, ...found]
          : found;
      setModels(merged);
      setTestMsg(`${found.length} model${found.length === 1 ? "" : "s"} found`);
    } catch (e: unknown) {
      setTestError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    try {
      const typed = apiKeyInput.trim();
      const { settings } = await updateSettings({
        provider,
        // Send the key only when the user typed one (keep the stored key otherwise).
        apiKey: typed || undefined,
        baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
        model: model || undefined,
      });
      setLoadedProvider(settings.provider);
      setApiKeySet(settings.apiKeySet);
      setApiKeyLast4(settings.apiKeyLast4);
      setAiUsage(settings.aiUsage);
      setApiKeyInput("");
      setSaveMsg("Saved");
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + a scrollable pane (below) instead of a taller-than-viewport
          dialog: at 390px the MCP and Live-sessions sections are far longer than
          the screen.
          `flex flex-col` is load-bearing and overrides DialogContent's own
          `grid`: a grid container's auto row is sized from its item's
          min-content HEIGHT and never shrinks to a max-height, so the row grew
          to the full ~900px of the MCP section, `overflow-hidden` clipped it,
          and the pane below never had a reason to scroll — the Tokens and
          Client-setup blocks were simply unreachable. As a flex column the
          single row IS the constrained box (`flex-1 min-h-0`), so the pane's
          own overflow-y takes over. */}
      <DialogContent className="flex max-h-[92svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogDescription className="sr-only">
          Configure Bookmark AI, including the AI provider and default model.
        </DialogDescription>
        {/* min-w-0 is load-bearing: DialogContent is a GRID container, and a grid
            item's automatic minimum size is its min-content width — so without
            it the widest thing in any section (a 259-char token, a
            claude-mcp-add command) sets the dialog's width and pushes its own
            buttons outside the clipped 672px box. Every child of this row needs
            the same reset, or the min-content width just propagates one level
            down. */}
        {/* flex-1 + min-h-0: this row is the dialog's only flex child, so it
            takes the clamped height and lets its scroll pane (not the page)
            absorb a long section. The 27rem floor — which keeps the desktop
            dialog from resizing every time you switch sections — is gated on
            the viewport being TALL enough to spare it, because a min-height
            beats a max-height in CSS and would re-break scrolling on a short
            landscape window. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row [@media(min-width:640px)_and_(min-height:40rem)]:min-h-[27rem]">
          <nav
            aria-label="Settings sections"
            className="shrink-0 border-b bg-muted/30 p-3 sm:w-48 sm:border-r sm:border-b-0"
          >
            <DialogHeader className="px-2 pb-3 text-left">
              <DialogTitle className="text-base">Settings</DialogTitle>
            </DialogHeader>
            {/* Mobile: one scrollable strip of section chips (six full-width
                buttons stacked would eat the whole screen, and letting them
                shrink truncated every label). contain:inline-size keeps the
                strip's summed width from becoming the dialog's min-content
                width — see the min-w-0 note above. */}
            <ul
              ref={railRef}
              className="-mb-2 flex scroll-smooth gap-1 overflow-x-auto pb-2 [contain:inline-size] sm:mb-0 sm:flex-col sm:overflow-x-visible sm:pb-0 sm:[contain:none]"
            >
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setSection(s.id)}
                      aria-current={section === s.id ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors",
                        section === s.id
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {section === "ai" && (
              <div className="space-y-5">
                {/* Free credits FIRST, everywhere: the shared AI is what powers
                    chat out of the box, and this pane used to open on a provider
                    form that implied setup was required. Dimmed once the user has
                    their own key, since own-key requests aren't metered. */}
                <AiCreditsCallout usage={aiUsage} loading={loading} dim={apiKeySet} />

                <div>
                  <h3 className="text-sm font-semibold">Use your own AI provider</h3>
                  <p className="text-xs text-muted-foreground">
                    Optional. Bring a key and chat runs unmetered on the provider and model you
                    pick.
                  </p>
                </div>

                {loading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Loading settings…
                  </div>
                ) : loadError ? (
                  <p className="text-sm text-destructive">Couldn’t load settings: {loadError}</p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label htmlFor="ai-provider" className="text-sm font-medium">
                        Provider
                      </label>
                      <Select value={provider} onValueChange={changeProvider}>
                        <SelectTrigger id="ai-provider" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDERS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="ai-key" className="text-sm font-medium">
                        API key
                      </label>
                      <Input
                        id="ai-key"
                        type="password"
                        autoComplete="off"
                        value={apiKeyInput}
                        onChange={(e) => {
                          setApiKeyInput(e.target.value);
                          setSaveMsg(null);
                        }}
                        placeholder={showSavedHint ? `Saved (••••${apiKeyLast4})` : "Enter API key"}
                      />
                    </div>

                    {provider === "custom" && (
                      <div className="space-y-1.5">
                        <label htmlFor="ai-base-url" className="text-sm font-medium">
                          API Base URL
                        </label>
                        <Input
                          id="ai-base-url"
                          type="url"
                          inputMode="url"
                          value={baseUrl}
                          onChange={(e) => {
                            setBaseUrl(e.target.value);
                            setSaveMsg(null);
                          }}
                          placeholder="https://api.example.com/v1"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={test}
                        disabled={testing || !hasKeySource || customNeedsUrl}
                      >
                        {testing ? (
                          <>
                            <Loader2 className="animate-spin" aria-hidden />
                            Testing…
                          </>
                        ) : (
                          "Test connection & get models"
                        )}
                      </Button>
                      {testMsg && (
                        <p className="text-sm text-emerald-600 dark:text-emerald-500">{testMsg}</p>
                      )}
                      {testError && <p className="text-sm text-destructive">{testError}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="ai-model" className="text-sm font-medium">
                        Default model
                      </label>
                      <Select value={model} onValueChange={setModel} disabled={models.length === 0}>
                        <SelectTrigger id="ai-model" className="w-full">
                          <SelectValue
                            placeholder={
                              models.length
                                ? "Select a model"
                                : "Test connection to list models"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t pt-4">
                      {saveMsg && <span className="text-sm text-muted-foreground">{saveMsg}</span>}
                      {saveError && <span className="text-sm text-destructive">{saveError}</span>}
                      <Button
                        type="button"
                        onClick={save}
                        disabled={saving || customNeedsUrl}
                      >
                        {saving ? (
                          <>
                            <Loader2 className="animate-spin" aria-hidden />
                            Saving…
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {section === "data" && <DataSection />}

            {section === "sync" && <SyncSection />}

            {section === "devices" && <DevicesSection />}

            {section === "mcp" && <McpSection />}

            {section === "account" && <AccountSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Data section: export the whole library to a JSON file, or import a previously
 * exported bundle back. Import merges by URL and preserves timestamps, so
 * re-importing the same file is a safe no-op (idempotent upsert).
 */
function DataSection() {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const runExport = async () => {
    setExporting(true);
    setExportMsg(null);
    setExportError(null);
    try {
      const bundle = await exportData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `bookmark-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      const { bookmarks, sessions } = bundle.counts;
      setExportMsg(
        `Exported ${bookmarks} bookmark${bookmarks === 1 ? "" : "s"} and ${sessions} session${
          sessions === 1 ? "" : "s"
        }.`,
      );
    } catch (e: unknown) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires change again.
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    setImportError(null);
    try {
      const text = await file.text();
      let bundle: unknown;
      try {
        bundle = JSON.parse(text);
      } catch {
        throw new Error("That file isn't a valid Bookmark AI export.");
      }
      const { imported } = await importData(bundle);
      setImportMsg(
        `Imported ${imported.bookmarks} bookmark${
          imported.bookmarks === 1 ? "" : "s"
        }, ${imported.sessions} session${imported.sessions === 1 ? "" : "s"}.`,
      );
    } catch (e: unknown) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Your data</h3>
        <p className="text-xs text-muted-foreground">
          Export a complete, portable copy of your library, or restore one back.
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-medium">Export</h4>
          <p className="text-xs text-muted-foreground">
            Downloads every bookmark and session as a single JSON file.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={runExport} disabled={exporting}>
          {exporting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Exporting…
            </>
          ) : (
            <>
              <Download aria-hidden />
              Export data
            </>
          )}
        </Button>
        {exportMsg && (
          <p className="text-sm text-emerald-600 dark:text-emerald-500">{exportMsg}</p>
        )}
        {exportError && <p className="text-sm text-destructive">{exportError}</p>}
      </div>

      <div className="space-y-2 border-t pt-5">
        <div>
          <h4 className="text-sm font-medium">Import</h4>
          <p className="text-xs text-muted-foreground">
            Merges an exported file by URL and keeps original timestamps —
            re-importing the same file is safe and won’t create duplicates.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={onFile}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        >
          {importing ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Importing…
            </>
          ) : (
            <>
              <Upload aria-hidden />
              Import data
            </>
          )}
        </Button>
        {importMsg && (
          <p className="text-sm text-emerald-600 dark:text-emerald-500">{importMsg}</p>
        )}
        {importError && <p className="text-sm text-destructive">{importError}</p>}
      </div>
    </div>
  );
}

/**
 * Account section: the permanent, irreversible account-deletion entry point
 * (required by the app stores and Clerk). A two-step confirm guards it; on
 * success it signs the user out and sends them to the marketing home.
 */
function AccountSection() {
  const { signOut } = useClerk();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // Clear the Clerk session and land on the public home page.
      await signOut({ redirectUrl: "/" });
    } catch (e: unknown) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Account</h3>
        <p className="text-xs text-muted-foreground">Manage your Bookmark AI account.</p>
      </div>

      <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Delete account</h4>
            <p className="text-xs text-muted-foreground">
              This permanently deletes your account and all of your bookmarks and
              sessions. This cannot be undone.
            </p>
          </div>
        </div>

        {!confirming ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            <Trash2 aria-hidden />
            Delete account
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium">
              Are you sure? This is permanent and cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={runDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Deleting…
                  </>
                ) : (
                  "Yes, delete my account"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
