"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, KeyRound, Loader2, Trash2, X, Zap } from "lucide-react";
import type { AiModel, AiProvider, AiUsage, UserSettings } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ownProviderRequest } from "@/lib/ai-setup";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchAiModels, getSettings, updateSettings } from "@/lib/api";
import {
  AI_MODE_COPY,
  type AiMode,
  providerNeedsModel,
  resolveAiMode,
  resolveOwnKeyReady,
} from "@/lib/ai-mode";
import { AiCreditsCallout, AiCreditsMeter } from "./ai-credits-meter";

/** What a Google key runs on when no model is chosen (server default —
 * `packages/types/src/settings.ts`). Display only; the server owns the choice. */
const GOOGLE_DEFAULT_MODEL = "gemini-3.8-flash";

/** OpenRouter is an OpenAI-compatible endpoint, so it maps to the `custom`
 * provider with this base URL — the recommended one-click preset. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: "google", label: "Gemini (Google)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
];

export interface AiSetupCardProps {
  /** Called after a successful save — the chat surface hides the card and refetches. */
  onSaved?: () => void;
  /** When set, renders a dismiss (×) button; used on the chat surface. */
  onDismiss?: () => void;
  /**
   * Start on the own-provider setup panel. The chat's
   * free-limit wall passes this: at that point the free credits are gone, so the
   * secondary option is the only one left and hiding it behind a chevron would be
   * a dead end.
   */
  defaultProviderOpen?: boolean;
  className?: string;
}

/** Shared AI source settings for onboarding, Settings, and the chat limit wall.
 * The selected panel is a draft; only successful server responses change the active source. */
export function AiSetupCard({
  onSaved,
  onDismiss,
  defaultProviderOpen,
  className,
}: AiSetupCardProps) {
  // ── Mode ──
  const [aiMode, setAiMode] = useState<AiMode>("included");
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<AiMode>(
    defaultProviderOpen ? "own" : "included",
  );

  // ── Provider form ──
  const [provider, setProvider] = useState<AiProvider>("google");
  const [loadedProvider, setLoadedProvider] = useState<AiProvider>("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  // BYOK completeness: a key for OpenAI/Anthropic/custom needs a chosen model
  // (only Google has a server default). Server `ownKeyReady`, derived locally
  // for older payloads.
  const [ownKeyReady, setOwnKeyReady] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [loadedModel, setLoadedModel] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);

  const [loading, setLoading] = useState(true);
  // Non-fatal: the form still works (type a key, save) — but a settings GET that
  // 500s used to be swallowed entirely, so a user staring at defaults had no way
  // to know the pane wasn't showing their saved provider.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [verifiedDraft, setVerifiedDraft] = useState<string | null>(null);
  const [rejectedDraft, setRejectedDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Remove key (two-step) ──
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removedMsg, setRemovedMsg] = useState<string | null>(null);

  // Optional credit details live inside the own-provider panel.
  const [creditsOpen, setCreditsOpen] = useState(false);

  /** Everything the GET/PUT response carries — used on load and after Save. */
  const applyAll = (settings: UserSettings) => {
    setProvider(settings.provider);
    setLoadedProvider(settings.provider);
    setBaseUrl(settings.baseUrl ?? "");
    setModel(settings.model ?? "");
    setLoadedModel(settings.model ?? "");
    setModels(settings.model ? [{ id: settings.model, label: settings.model }] : []);
    applyStatus(settings);
  };

  /** The key/mode/meter slice only — after a mode switch or key removal, so a
   * half-edited provider form isn't yanked back to the stored values. */
  const applyStatus = (settings: UserSettings) => {
    setApiKeySet(settings.apiKeySet);
    setApiKeyLast4(settings.apiKeyLast4);
    setAiUsage(settings.aiUsage);
    setAiMode(resolveAiMode(settings));
    setOwnKeyReady(resolveOwnKeyReady(settings));
  };

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(({ settings }) => {
        if (!cancelled) {
          applyAll(settings);
          if (!defaultProviderOpen) setSelectedSource(resolveAiMode(settings));
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load
  }, []);

  // A stored key belongs to the saved provider; switching provider retires the hint.
  const showSavedHint = apiKeySet && provider === loadedProvider;
  const hasKeySource = apiKeyInput.trim().length > 0 || showSavedHint;
  const customNeedsUrl = provider === "custom" && !baseUrl.trim();
  // OpenRouter is "in use" when the saved custom endpoint points at it.
  const openRouterActive = provider === "custom" && baseUrl.trim() === OPENROUTER_BASE_URL;
  const savedProviderLabel =
    PROVIDERS.find((p) => p.value === loadedProvider)?.label ?? loadedProvider;
  const providerLabel = PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
  // Save is complete only with a model for providers that need one; Google's
  // server default (gemini-3.8-flash) is the one exception.
  const needsModel = providerNeedsModel(provider) && !model.trim();
  const draftIdentity = JSON.stringify([provider, baseUrl.trim(), apiKeyInput.trim()]);
  const keyVerified = verifiedDraft === draftIdentity;
  const keyRejected = rejectedDraft === draftIdentity;
  const verificationNeeded = !!apiKeyInput.trim() && provider !== "custom" && !keyVerified;
  const keyIncomplete = apiKeySet && aiMode === "own" && !ownKeyReady;

  /** "Saved key ••••1234 · Gemini (Google) · gemini-3.8-flash" — a Google key
   * with no chosen model names the server default so the line never ends in
   * a provider with no visible model. */
  const savedModelLabel =
    loadedModel || (loadedProvider === "google" ? `${GOOGLE_DEFAULT_MODEL} (default)` : "");
  const keySummary = apiKeySet
    ? `Saved key ••••${apiKeyLast4 ?? "????"} · ${savedProviderLabel}${savedModelLabel ? ` · ${savedModelLabel}` : ""}`
    : null;

  const switchMode = async (next: AiMode) => {
    if (next === aiMode || modeSaving) return;
    setModeError(null);
    setRemovedMsg(null);
    if (next === "own" && !apiKeySet) {
      // The server would 400 ("Add an API key before switching…"); open the form
      // instead and let a saved key do the switching (the PUT sets the mode).
      setSelectedSource("own");
      return;
    }
    setModeSaving(true);
    try {
      const { settings } = await updateSettings({ aiMode: next });
      applyStatus(settings);
      onSaved?.();
    } catch (e: unknown) {
      setModeError((e as Error).message);
    } finally {
      setModeSaving(false);
    }
  };

  const changeProvider = (value: string) => {
    const next = value as AiProvider;
    setProvider(next);
    // Model ids are provider-specific, so a different provider starts the picker
    // blank; coming BACK to the saved provider restores the saved model. Nothing
    // is persisted until Save (see the `model` rule there).
    if (next === loadedProvider) {
      setModel(loadedModel);
      setModels(loadedModel ? [{ id: loadedModel, label: loadedModel }] : []);
    } else {
      setModel("");
      setModels([]);
    }
    setTestMsg(null);
    setTestError(null);
    setSaved(false);
  };

  const useOpenRouter = () => {
    changeProvider("custom");
    setBaseUrl(OPENROUTER_BASE_URL);
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
      const merged =
        model && !found.some((m) => m.id === model)
          ? [{ id: model, label: model }, ...found]
          : found;
      setModels(merged);
      setVerifiedDraft(draftIdentity);
      setRejectedDraft(null);
      setTestMsg(
        `Connection verified · ${found.length} model${found.length === 1 ? "" : "s"} found`,
      );
    } catch (e: unknown) {
      if ((e as Error).message === "Invalid API key") setRejectedDraft(draftIdentity);
      setTestError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setRemovedMsg(null);
    try {
      const request = ownProviderRequest({
        provider,
        loadedProvider,
        apiKey: apiKeyInput,
        apiKeySet,
        keyVerified,
        keyRejected,
        baseUrl,
        model,
      });
      if (!request) throw new Error("Add a key and complete the provider setup before using it.");
      const { settings } = await updateSettings(request);
      applyAll(settings);
      setApiKeyInput("");
      setSaved(true);
      onSaved?.();
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** The ONLY path that sends `apiKey: ""`. */
  const removeKey = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      const last4 = apiKeyLast4;
      const { settings } = await updateSettings({ apiKey: "" });
      applyStatus(settings);
      setSelectedSource("included");
      setApiKeyInput("");
      setConfirmRemove(false);
      setRemovedMsg(`Key ••••${last4 ?? "????"} removed. Chat runs on the included free AI.`);
      onSaved?.();
    } catch (e: unknown) {
      setRemoveError((e as Error).message);
    } finally {
      setRemoving(false);
    }
  };

  // The saved-key summary + "Remove key…" — visible in BOTH modes whenever a key
  // is stored, so the user can always see what's saved without opening the form.
  // In "own" mode this block IS the status (green, "Using your own key"); a
  // separate status card above it just repeated the same sentence.
  const ownActive = aiMode === "own";
  const keySummaryBlock = keySummary && (
    <div
      className={cn(
        "mt-2 rounded-lg border p-3",
        ownActive && ownKeyReady ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2">
        {ownActive ? (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15">
            <Check className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
          </div>
        ) : (
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">
            {ownActive && ownKeyReady ? "Using your own provider" : "Saved provider"}
          </p>
          <p
            className={cn(
              "text-xs [overflow-wrap:anywhere]",
              ownActive ? "mt-0.5 text-muted-foreground" : "font-medium",
            )}
          >
            {keySummary}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {ownActive && ownKeyReady
              ? AI_MODE_COPY.own
              : ownActive
                ? AI_MODE_COPY.ownKeyIncomplete
                : "Configured, not active. Save and use this provider to switch chat."}
          </p>
        </div>
        {!confirmRemove && (
          <button
            type="button"
            onClick={() => {
              setRemoveError(null);
              setConfirmRemove(true);
            }}
            className="cursor-pointer inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove key…
          </button>
        )}
      </div>
      {confirmRemove && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
          <p className="min-w-0 flex-1 text-xs">
            Remove the saved key ••••{apiKeyLast4}? Chat switches back to the included free AI.
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void removeKey()}
            disabled={removing}
          >
            {removing ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Removing…
              </>
            ) : (
              "Remove key"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(false)}
            disabled={removing}
          >
            Cancel
          </Button>
        </div>
      )}
      {removeError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {removeError}
        </p>
      )}
    </div>
  );

  // Provider setup is shown only in the selected own-provider panel.
  const providerForm = loading ? (
    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading…
    </div>
  ) : (
    <div className="space-y-3">
      {/* Recommended preset — OpenRouter (an OpenAI-compatible custom endpoint). */}
      <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 shrink-0 text-primary" aria-hidden />
          <p className="text-sm font-medium">Recommended: OpenRouter</p>
          {openRouterActive && (
            <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-500">
              Selected
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          OpenRouter has free models. Create a key, click below, then paste it in.
        </p>
        <Button
          type="button"
          size="sm"
          variant={openRouterActive ? "secondary" : "outline"}
          className="mt-2 min-h-11"
          onClick={useOpenRouter}
        >
          Use OpenRouter
        </Button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ai-setup-provider" className="text-xs font-medium">
          Provider
        </label>
        <Select value={provider} onValueChange={changeProvider}>
          <SelectTrigger id="ai-setup-provider" className="min-h-11 w-full">
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

      {provider === "custom" && (
        <div className="space-y-1.5">
          <label htmlFor="ai-setup-url" className="text-xs font-medium">
            API base URL
          </label>
          <Input
            className="min-h-11 text-base sm:text-sm"
            id="ai-setup-url"
            type="url"
            inputMode="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setSaved(false);
            }}
            placeholder="https://api.example.com/v1"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="ai-setup-key" className="text-xs font-medium">
          API key
        </label>
        <Input
          id="ai-setup-key"
          type="password"
          autoComplete="off"
          value={apiKeyInput}
          onChange={(e) => {
            setApiKeyInput(e.target.value);
            setSaved(false);
          }}
          placeholder={
            showSavedHint
              ? `Saved (••••${apiKeyLast4}) — paste a new key to replace it`
              : "Paste your API key"
          }
        />
        {apiKeySet && provider !== loadedProvider && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Your saved key belongs to {savedProviderLabel}. Paste a key for this provider, or switch
            back to keep using it.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={test}
          disabled={testing || !hasKeySource || customNeedsUrl}
        >
          {testing ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Verifying…
            </>
          ) : provider === "custom" ? (
            "Check connection & list models"
          ) : (
            "Verify key & list models"
          )}
        </Button>
        {testMsg && keyVerified && (
          <span className="text-xs text-emerald-600 dark:text-emerald-500">{testMsg}</span>
        )}
        {testError && (
          <span role="alert" className="text-xs text-destructive">
            {testError}
          </span>
        )}
      </div>

      {/* Always rendered, disabled until a test returns a list: hiding the field
          entirely made "Test & list models" look like it did nothing, because the
          thing it fills in wasn't on screen to change. The placeholder is the
          instruction. */}
      <div className="space-y-1.5">
        <label htmlFor="ai-setup-model" className="text-xs font-medium">
          Default model
        </label>
        {provider === "custom" && (
          <Input
            id="ai-setup-model-manual"
            aria-label="Model ID"
            className="min-h-11 text-base sm:text-sm"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setSaved(false);
            }}
            placeholder="Enter a model ID, or select one below"
          />
        )}
        <Select
          value={model}
          onValueChange={(value) => {
            setModel(value);
            setSaved(false);
          }}
          disabled={models.length === 0}
        >
          <SelectTrigger
            id="ai-setup-model"
            className="min-h-11 w-full"
            aria-invalid={needsModel || undefined}
          >
            <SelectValue
              placeholder={models.length ? "Select a model" : "Verify the key to list models"}
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

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          onClick={save}
          disabled={
            saving ||
            !hasKeySource ||
            customNeedsUrl ||
            needsModel ||
            verificationNeeded ||
            keyRejected
          }
          title={needsModel ? `${providerLabel} needs a model before saving` : undefined}
        >
          {saving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : aiMode === "own" ? (
            "Save changes"
          ) : (
            "Save and use provider"
          )}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
            <Check className="size-3.5" aria-hidden />
            Saved — provider active
          </span>
        )}
        {saveError && (
          <span role="alert" className="text-xs text-destructive">
            {saveError}
          </span>
        )}
        {verificationNeeded && (
          <p className="text-xs text-muted-foreground">
            Verify this new key before saving and using it.
          </p>
        )}
        {provider === "custom" && apiKeyInput.trim() && !keyVerified && !keyRejected && (
          <p className="text-xs text-muted-foreground">
            Connection unverified. If this endpoint does not list models, enter its model ID before
            saving.
          </p>
        )}
        {needsModel ? (
          <span className="text-xs text-muted-foreground">
            {providerLabel} needs a model — verify the key, then pick one.
          </span>
        ) : (
          !apiKeySet &&
          !saved && (
            <span className="text-xs text-muted-foreground">
              Your provider is used only after a successful save.
            </span>
          )
        )}
      </div>
    </div>
  );

  return (
    <div className={cn("relative rounded-xl border bg-card p-4 text-card-foreground", className)}>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="cursor-pointer absolute right-2 top-2 z-10 flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}

      <div className={cn("space-y-3", onDismiss && "pr-8")}>
        <p className="text-sm font-medium">Choose what powers chat</p>
        <div role="group" aria-label="Chat AI source" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                value: "included",
                title: "Included AI",
                description: "Free weekly credits · no setup",
              },
              {
                value: "own",
                title: "Your own provider",
                description: "Your key, provider and model",
              },
            ] as const
          ).map(({ value, title, description }) => (
            <button
              key={value}
              type="button"
              aria-pressed={selectedSource === value}
              disabled={loading || !!loadError || modeSaving || saving || removing || testing}
              onClick={() => {
                setSelectedSource(value);
                setModeError(null);
                setSaveError(null);
              }}
              className={cn(
                "min-h-16 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                selectedSource === value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {title}
                {selectedSource === value && <Check className="size-4 shrink-0" aria-hidden />}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {loading
          ? "Loading active source…"
          : loadError
            ? "Active source unavailable."
            : modeSaving || saving
              ? "Saving source…"
              : aiMode === "own" && ownKeyReady
                ? `Active: your provider · ${savedProviderLabel}${savedModelLabel ? ` · ${savedModelLabel}` : ""}`
                : aiMode === "own"
                  ? "Your saved provider needs a model. Chat currently falls back to included AI."
                  : "Active: included AI"}
      </p>
      {loadError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          Couldn’t load settings: {loadError}. Reopen this panel to retry.
        </p>
      )}
      {modeError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {modeError}
        </p>
      )}
      {removedMsg && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {removedMsg}
        </p>
      )}
      <fieldset
        disabled={loading || !!loadError || modeSaving || saving || removing || testing}
        className="mt-4 min-w-0 space-y-4"
      >
        {selectedSource === "included" ? (
          <>
            <AiCreditsCallout
              usage={aiUsage}
              loading={loading}
              dim={aiMode === "own" && ownKeyReady}
            />
            {apiKeySet && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {AI_MODE_COPY.includedWithKey}
              </p>
            )}
            {aiMode !== "included" && (
              <Button
                type="button"
                className="min-h-11"
                onClick={() => void switchMode("included")}
              >
                {modeSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Switching…
                  </>
                ) : (
                  "Use included AI"
                )}
              </Button>
            )}
          </>
        ) : (
          <>
            {keySummaryBlock}
            {keyIncomplete && (
              <p role="alert" className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {AI_MODE_COPY.ownKeyIncomplete}
              </p>
            )}
            {providerForm}
            <Collapsible open={creditsOpen} onOpenChange={setCreditsOpen}>
              <CollapsibleTrigger
                type="button"
                className="group flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted/60"
              >
                <span className="text-xs font-medium">Included credits</span>
                <ChevronDown
                  className="ml-auto size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pt-3">
                <AiCreditsMeter usage={aiUsage} loading={loading} dim />
                <p className="mt-2 text-xs text-muted-foreground">
                  Chat does not use these credits while a complete own-provider setup is active.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </fieldset>

      {/* Embeddings for search-by-meaning are served for free for now — no key needed. */}
      <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
        Search by meaning is included free — its embeddings are powered by the service, so you
        don&apos;t need an embedding key.
      </p>
    </div>
  );
}
