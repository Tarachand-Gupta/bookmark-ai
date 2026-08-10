"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, KeyRound, Loader2, X, Zap } from "lucide-react";
import type { AiModel, AiProvider, AiUsage } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchAiModels, getSettings, updateSettings } from "@/lib/api";
import { AiCreditsCallout, AiCreditsMeter } from "./ai-credits-meter";

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
   * Start with the "Use your own AI provider" section EXPANDED. The chat's
   * free-limit wall passes this: at that point the free credits are gone, so the
   * secondary option is the only one left and hiding it behind a chevron would be
   * a dead end.
   */
  defaultProviderOpen?: boolean;
  className?: string;
}

/**
 * The one AI-setup surface, used in three places: the onboarding tour's AI step,
 * Settings → AI (which used to duplicate this form inline — one source of truth
 * now), and the chat's free-limit wall.
 *
 * FREE CREDITS LEAD. The card used to open on a provider/key form, which told
 * every new user that AI needs setup — it doesn't. So the hero is now the free
 * weekly credit meter ("Free AI included"), and bring-your-own-provider is a
 * COLLAPSED secondary section beneath it. When the user already HAS a key saved
 * the emphasis inverts: their provider summary leads (it's what actually powers
 * their chat) and the free meter collapses to a footnote, since own-key requests
 * aren't metered at all.
 */
export function AiSetupCard({
  onSaved,
  onDismiss,
  defaultProviderOpen,
  className,
}: AiSetupCardProps) {
  const [provider, setProvider] = useState<AiProvider>("google");
  const [loadedProvider, setLoadedProvider] = useState<AiProvider>("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);

  const [loading, setLoading] = useState(true);
  // Non-fatal: the form still works (type a key, save) — but a settings GET that
  // 500s used to be swallowed entirely, so a user staring at defaults had no way
  // to know the pane wasn't showing their saved provider. Settings → AI surfaced
  // this line before the two forms were unified; it now lives here.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Which of the two paths is expanded. The provider section starts closed
  // (free-first) unless the caller says otherwise; the credits section only
  // exists in the has-key layout and starts closed there.
  const [providerOpen, setProviderOpen] = useState(!!defaultProviderOpen);
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setProvider(settings.provider);
        setLoadedProvider(settings.provider);
        setBaseUrl(settings.baseUrl ?? "");
        setModel(settings.model ?? "");
        setModels(settings.model ? [{ id: settings.model, label: settings.model }] : []);
        setApiKeySet(settings.apiKeySet);
        setApiKeyLast4(settings.apiKeyLast4);
        setAiUsage(settings.aiUsage);
      })
      .catch((e: unknown) => {
        // A failed load leaves the defaults; the user can still fill and save —
        // but say so rather than pretending these ARE their settings.
        if (!cancelled) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A stored key belongs to the saved provider; switching provider retires the hint.
  const showSavedHint = apiKeySet && provider === loadedProvider;
  const hasKeySource = apiKeyInput.trim().length > 0 || showSavedHint;
  const customNeedsUrl = provider === "custom" && !baseUrl.trim();
  // OpenRouter is "in use" when the saved custom endpoint points at it.
  const openRouterActive = provider === "custom" && baseUrl.trim() === OPENROUTER_BASE_URL;
  const savedProviderLabel =
    PROVIDERS.find((p) => p.value === loadedProvider)?.label ?? loadedProvider;

  const changeProvider = (value: string) => {
    setProvider(value as AiProvider);
    setModels([]);
    setModel("");
    setTestMsg(null);
    setTestError(null);
    setSaved(false);
  };

  const useOpenRouter = () => {
    setProvider("custom");
    setBaseUrl(OPENROUTER_BASE_URL);
    setModels([]);
    setModel("");
    setTestMsg(null);
    setTestError(null);
    setSaved(false);
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
      setTestMsg(`${found.length} model${found.length === 1 ? "" : "s"} found`);
    } catch (e: unknown) {
      setTestError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const typed = apiKeyInput.trim();
      const { settings } = await updateSettings({
        provider,
        apiKey: typed || undefined,
        baseUrl: provider === "custom" ? baseUrl.trim() : undefined,
        model: model || undefined,
      });
      setLoadedProvider(settings.provider);
      setApiKeySet(settings.apiKeySet);
      setApiKeyLast4(settings.apiKeyLast4);
      setAiUsage(settings.aiUsage);
      setApiKeyInput("");
      setSaved(true);
      onSaved?.();
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // The provider/key/model form, unchanged in behavior — it just lives inside a
  // collapsible now instead of being the card's front page.
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
          className="mt-2"
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
          <SelectTrigger id="ai-setup-provider" className="w-full">
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
          placeholder={showSavedHint ? `Saved (••••${apiKeyLast4})` : "Paste your API key"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
            "Test & list models"
          )}
        </Button>
        {testMsg && (
          <span className="text-xs text-emerald-600 dark:text-emerald-500">{testMsg}</span>
        )}
        {testError && <span className="text-xs text-destructive">{testError}</span>}
      </div>

      {/* Always rendered, disabled until a test returns a list: hiding the field
          entirely made "Test & list models" look like it did nothing, because the
          thing it fills in wasn't on screen to change. The placeholder is the
          instruction. */}
      <div className="space-y-1.5">
        <label htmlFor="ai-setup-model" className="text-xs font-medium">
          Default model
        </label>
        <Select value={model} onValueChange={setModel} disabled={models.length === 0}>
          <SelectTrigger id="ai-setup-model" className="w-full">
            <SelectValue
              placeholder={models.length ? "Select a model" : "Test connection to list models"}
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

      <div className="flex items-center gap-3 pt-1">
        <Button type="button" size="sm" onClick={save} disabled={saving || customNeedsUrl}>
          {saving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
            <Check className="size-3.5" aria-hidden />
            Saved
          </span>
        )}
        {saveError && <span className="text-xs text-destructive">{saveError}</span>}
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
          className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}

      {apiKeySet ? (
        // ── Has own key: their provider leads, free credits become a footnote ──
        <>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
            <div className="flex items-start gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15">
                <Check className="size-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">
                  Using your own AI provider
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {savedProviderLabel} · key ••••{apiKeyLast4}
                  {model ? ` · ${model}` : ""}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Chat runs on your key and your quota — the free weekly credits below aren&apos;t
                  being spent.
                </p>
              </div>
            </div>
          </div>

          <Collapsible open={creditsOpen} onOpenChange={setCreditsOpen} className="mt-3">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60">
              <span className="text-sm font-medium">Free AI credits</span>
              <span className="text-xs text-muted-foreground">Unused while your key is set</span>
              <ChevronDown
                className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-1 pt-3">
              <AiCreditsMeter usage={aiUsage} loading={loading} dim />
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        // ── No own key: the free tier IS the product. Lead with it. ──
        <AiCreditsCallout usage={aiUsage} loading={loading} className={onDismiss ? "pr-8" : undefined} />
      )}

      {/* Outside the collapsible on purpose: a swallowed load error is invisible,
          and it must be readable even while the provider section is closed. */}
      {loadError && (
        <p className="mt-3 text-xs leading-relaxed text-destructive">
          Couldn’t load settings: {loadError}
        </p>
      )}

      <Collapsible open={providerOpen} onOpenChange={setProviderOpen} className="mt-3">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60">
          <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">
            {apiKeySet ? "Change provider or model" : "Use your own AI provider"}
          </span>
          {!apiKeySet && <span className="text-xs text-muted-foreground">Optional</span>}
          <ChevronDown
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">{providerForm}</CollapsibleContent>
      </Collapsible>

      {/* Embeddings for search-by-meaning are served for free for now — no key needed. */}
      <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
        Search by meaning is included free — its embeddings are powered by the service, so you
        don&apos;t need an embedding key.
      </p>
    </div>
  );
}
