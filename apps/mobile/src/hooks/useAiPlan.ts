import { useCallback, useEffect, useRef, useState } from "react";
import type { AiMode, PlanId, UserSettings } from "@bookmark-ai/types";
import { getAccount, getSettings, updateSettings } from "../api";

export interface AiPlanState {
  /** The account's plan; "free" until the API says otherwise (there is no other plan yet). */
  plan: PlanId;
  /** AI settings as the API exposes them (mode, saved-key summary, weekly meter), or null while loading / on failure. */
  settings: UserSettings | null;
  loading: boolean;
  /** The load failed (the account row and the AI group show a retry). */
  error: string | null;
  /** A mode switch is in flight. */
  saving: boolean;
  /** A mode switch failed — shown under the control; cleared by the next attempt. */
  saveError: string | null;
  setAiMode: (mode: AiMode) => void;
  reload: () => void;
}

/**
 * Settings → Plan + Ask AI: one load of `/api/account` and `/api/settings` (in
 * parallel) when the Settings presentation opens, plus the ONE write mobile
 * makes — `PUT { aiMode }`. The switch is optimistic (the segmented control moves
 * at once) and reverts with the server's message on failure — e.g. the 400 for
 * "own" when no key is stored, which the UI never offers but a stale screen
 * could hit.
 */
export function useAiPlan(): AiPlanState {
  const [plan, setPlan] = useState<PlanId>("free");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards stale async writes: only the newest run may touch state.
  const runId = useRef(0);

  useEffect(() => {
    const run = ++runId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([getAccount(controller.signal), getSettings(controller.signal)])
      .then(([account, response]) => {
        if (runId.current !== run) return;
        setPlan(account.plan);
        setSettings(response.settings);
      })
      .catch((err: unknown) => {
        if (runId.current !== run) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (runId.current === run) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const setAiMode = useCallback(
    (mode: AiMode) => {
      if (settings === null || settings.aiMode === mode || saving) return;
      const previous = settings;
      setSaveError(null);
      setSaving(true);
      setSettings({ ...settings, aiMode: mode });
      updateSettings({ aiMode: mode })
        .then((response) => setSettings(response.settings))
        .catch((err: unknown) => {
          setSettings(previous);
          setSaveError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setSaving(false));
    },
    [settings, saving],
  );

  return { plan, settings, loading, error, saving, saveError, setAiMode, reload };
}
