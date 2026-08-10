"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, X, Zap } from "lucide-react";
import type { AiModel, AiProvider } from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
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
  className?: string;
}

/**
 * Slim, self-contained "bring your own AI provider" card. Same PUT semantics as
 * the Settings → AI pane (a deliberate slim variant, not a refactor of the
 * dialog): pick a provider, paste a key, optionally test to list models, Save.
 * OpenRouter is the recommended preset (custom endpoint + free models).
 *
 * It is ~565px tall, so it only belongs where it IS the content: the onboarding
 * dialog, and inside the chat's message scroller once the free-limit wall's CTA
 * asks for it. The chat's passive upsell is a one-line banner instead (see
 * ai-chat.tsx) — pinned above the thread this card left ~150px for the
 * conversation and buried every answer.
 */
export function AiSetupCard({ onSaved, onDismiss, className }: AiSetupCardProps) {
  const [provider, setProvider] = useState<AiProvider>("google");
  const [loadedProvider, setLoadedProvider] = useState<AiProvider>("google");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModel[]>([]);

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      })
      .catch(() => {
        // A failed load leaves the defaults; the user can still fill and save.
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
      setApiKeyInput("");
      setSaved(true);
      onSaved?.();
    } catch (e: unknown) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("rounded-xl border bg-card p-4 text-card-foreground", className)}>
      <div className="flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Use your own AI provider</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Connect a key to power chat and answers with the model you choose.
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Recommended preset — OpenRouter (an OpenAI-compatible custom endpoint). */}
      <div className="mt-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
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

      {loading ? (
        <div className="mt-4 flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : (
        <div className="mt-4 space-y-3">
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

          {models.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="ai-setup-model" className="text-xs font-medium">
                Default model
              </label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="ai-setup-model" className="w-full">
                  <SelectValue placeholder="Select a model" />
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
          )}

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
      )}

      {/* Embeddings for search-by-meaning are served for free for now — no key needed. */}
      <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
        Search by meaning is included free — its embeddings are powered by the service, so you
        don&apos;t need an embedding key.
      </p>
    </div>
  );
}
